import * as vscode from "vscode";

export class PerplexityCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private debounceTimer?: NodeJS.Timeout;
  // Removed unused: private lastPosition?: vscode.Position;
  // Removed unused: private lastCompletion?: string;

  constructor(private context: vscode.ExtensionContext) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const config = vscode.workspace.getConfiguration("perplexityAI");
    const enabled = config.get("completionEnabled", true);

    if (!enabled) {
      return undefined;
    }

    // Debouncing logic
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    return new Promise((resolve) => {
      this.debounceTimer = setTimeout(async () => {
        try {
          const apiKey = await this.context.secrets.get("perplexity-api-key");
          if (!apiKey) {
            resolve(undefined);
            return;
          }

          const linePrefix = document
            .lineAt(position.line)
            .text.substring(0, position.character);

          // Check if it's a prompt-based request (comment)
          const isPromptRequest =
            linePrefix.trim().startsWith("//") ||
            linePrefix.trim().startsWith("#") ||
            linePrefix.trim().startsWith("/*");

          if (isPromptRequest && linePrefix.trim().length < 5) {
            resolve(undefined);
            return;
          }

          // Get context (previous lines)
          const contextLines = Math.min(position.line, 20);
          const contextStart = Math.max(0, position.line - contextLines);
          const contextRange = new vscode.Range(
            contextStart,
            0,
            position.line,
            position.character
          );
          const context = document.getText(contextRange);

          let prompt: string;
          if (isPromptRequest) {
            const commentText = linePrefix
              .replace(/^[\s]*[\/\/#\*]+[\s]*/, "")
              .trim();
            prompt = `Generate code based on this instruction: "${commentText}". Language: ${document.languageId}. Provide only the code, no explanations.`;
          } else {
            prompt = `Continue this ${document.languageId} code naturally. Context:\n${context}\n\nProvide only the next line(s) of code, no explanations:`;
          }

          const completion = await this.getCompletion(
            apiKey,
            prompt,
            document.languageId
          );

          if (completion && completion.trim()) {
            const cleanedCompletion = this.cleanResponse(completion);

            if (cleanedCompletion) {
              const item = new vscode.InlineCompletionItem(
                cleanedCompletion,
                new vscode.Range(position, position)
              );
              resolve([item]);
              return;
            }
          }

          resolve(undefined);
        } catch (error) {
          console.error("Completion error:", error);
          resolve(undefined);
        }
      }, 500); // 500ms debounce
    });
  }

  private async getCompletion(
    apiKey: string,
    prompt: string,
    _language: string
  ): Promise<string> {
    const config = vscode.workspace.getConfiguration("perplexityAI");
    const model = config.get("completionModel", "sonar");

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.2,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices: { message?: { content?: string } }[];
    };
    return data.choices[0]?.message?.content || "";
  }

  private cleanResponse(response: string): string {
    // Remove code block markers
    let cleaned = response.replace(/```[\w]*/g, "");

    // Remove explanatory text (lines starting with certain patterns)
    const lines = cleaned.split("\n");
    const codeLinesOnly = lines.filter((line) => {
      const trimmed = line.trim();
      return (
        !trimmed.startsWith("Here") &&
        !trimmed.startsWith("This") &&
        !trimmed.startsWith("The") &&
        !trimmed.startsWith("Note:") &&
        !trimmed.match(/^(Explanation|Example|Output):/i)
      );
    });

    return codeLinesOnly.join("\n").trim();
  }

  outputChannel = vscode.window.createOutputChannel("PerplexityAI");
}
