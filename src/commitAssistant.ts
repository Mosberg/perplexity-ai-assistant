import * as cp from "child_process";
import { promisify } from "util";
import * as vscode from "vscode";

const exec = promisify(cp.exec);

export class CommitAssistant {
  constructor(private context: vscode.ExtensionContext) {}

  async generateCommitMessage() {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      const workspaceFolder =
        workspaceFolders && workspaceFolders.length > 0
          ? workspaceFolders[0]
          : undefined;
      if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder open");
        return;
      }

      const gitExtension =
        vscode.extensions.getExtension("vscode.git")?.exports;
      if (!gitExtension) {
        vscode.window.showErrorMessage("Git extension not found");
        return;
      }

      const api = gitExtension.getAPI(1);
      const repo = api.repositories;

      if (!repo) {
        vscode.window.showErrorMessage("No Git repository found");
        return;
      }

      // Get diff
      const diff = await this.getGitDiff(workspaceFolder.uri.fsPath);

      if (!diff || diff.trim().length === 0) {
        vscode.window.showInformationMessage("No changes to commit");
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Generating commit message...",
          cancellable: false,
        },
        async () => {
          const apiKey = await this.context.secrets.get("perplexity-api-key");
          if (!apiKey) {
            vscode.window.showErrorMessage("API key not configured");
            return;
          }

          const commitMessage = await this.analyzeChangesAndGenerateCommit(
            apiKey,
            diff
          );

          if (commitMessage) {
            repo.inputBox.value = commitMessage;
            vscode.window.showInformationMessage("Commit message generated!");
          }
        }
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Error generating commit: ${error}`);
    }
  }

  async generateCommitForStaged() {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders;
      if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder open");
        return;
      }

      const diff = await this.getGitDiff(workspaceFolder.uri.fsPath, true);

      if (!diff || diff.trim().length === 0) {
        vscode.window.showInformationMessage("No staged changes");
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Analyzing staged changes...",
          cancellable: false,
        },
        async () => {
          const apiKey = await this.context.secrets.get("perplexity-api-key");
          if (!apiKey) {
            vscode.window.showErrorMessage("API key not configured");
            return;
          }

          const commitMessage = await this.analyzeChangesAndGenerateCommit(
            apiKey,
            diff
          );

          if (commitMessage) {
            const gitExtension =
              vscode.extensions.getExtension("vscode.git")?.exports;
            const api = gitExtension.getAPI(1);
            const repo = api.repositories;

            if (repo) {
              repo.inputBox.value = commitMessage;
              vscode.window.showInformationMessage(
                "Commit message generated for staged changes!"
              );
            }
          }
        }
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Error: ${error}`);
    }
  }

  async analyzeChanges() {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders;
      if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder open");
        return;
      }

      const diff = await this.getGitDiff(workspaceFolder.uri.fsPath);

      if (!diff || diff.trim().length === 0) {
        vscode.window.showInformationMessage("No changes detected");
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Analyzing changes...",
          cancellable: false,
        },
        async () => {
          const apiKey = await this.context.secrets.get("perplexity-api-key");
          if (!apiKey) {
            vscode.window.showErrorMessage("API key not configured");
            return;
          }

          const analysis = await this.analyzeGitChanges(apiKey, diff);

          if (analysis) {
            const doc = await vscode.workspace.openTextDocument({
              content: `# Change Analysis\n\n${analysis}`,
              language: "markdown",
            });
            await vscode.window.showTextDocument(doc);
          }
        }
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Error analyzing changes: ${error}`);
    }
  }

  private async getGitDiff(cwd: string, staged = false): Promise<string> {
    try {
      const command = staged ? "git diff --cached" : "git diff";
      const { stdout } = await exec(command, {
        cwd,
        maxBuffer: 1024 * 1024 * 10,
      });
      return stdout;
    } catch (error) {
      throw new Error(`Failed to get git diff: ${error}`);
    }
  }

  private async analyzeChangesAndGenerateCommit(
    apiKey: string,
    diff: string
  ): Promise<string> {
    const truncatedDiff =
      diff.length > 6000
        ? diff.substring(0, 6000) + "\n\n... (truncated)"
        : diff;

    const prompt = `Analyze this git diff and generate a conventional commit message. Follow these guidelines:
1. Use Conventional Commits format: type(scope): description
2. Types: feat, fix, docs, style, refactor, test, chore, perf, ci, build
3. Keep the first line under 72 characters
4. If needed, add a body explaining the changes
5. Focus on WHAT changed and WHY, not HOW

Git diff:
\`\`\`
${truncatedDiff}
\`\`\`

Generate ONLY the commit message, nothing else:`;

    const config = vscode.workspace.getConfiguration("perplexityAI");
    const model = config.get("model", "sonar");

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    let commitMessage =
      (data.choices && data.choices[0]?.message?.content) || "";

    // Clean up the response
    commitMessage = commitMessage.replace(/```[\w]*\n?/g, "").trim();
    commitMessage = commitMessage.replace(/^["']|["']$/g, "");

    return commitMessage;
  }

  private async analyzeGitChanges(
    apiKey: string,
    diff: string
  ): Promise<string> {
    const truncatedDiff =
      diff.length > 8000
        ? diff.substring(0, 8000) + "\n\n... (truncated)"
        : diff;

    const prompt = `Provide a detailed analysis of these git changes. Include:
1. Summary of changes
2. Files affected
3. Type of changes (features, fixes, refactoring, etc.)
4. Potential impact
5. Suggestions (if any)

Git diff:
\`\`\`
${truncatedDiff}
\`\`\``;

    const config = vscode.workspace.getConfiguration("perplexityAI");
    const model = config.get("model", "sonar");

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return (
      (data.choices && data.choices[0]?.message?.content) ||
      "No analysis available"
    );
  }

  outputChannel = vscode.window.createOutputChannel("Commit Assistant");
}
