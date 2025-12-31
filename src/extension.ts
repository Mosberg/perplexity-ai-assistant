import * as vscode from "vscode";
import { PerplexityCustomChatProvider } from "./chatProvider";
import { PerplexitySettingsProvider } from "./settingsProvider";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
  vscode.commands.executeCommand("setContext", "perplexity-ai.enabled", true);
  // Initialize providers
  const chatProvider = new PerplexityCustomChatProvider(
    context.extensionUri,
    context
  );
  const settingsProvider = new PerplexitySettingsProvider(
    context.extensionUri,
    context
  );

  // Register webview providers
  const registration = vscode.window.registerWebviewViewProvider(
    PerplexityCustomChatProvider.viewType,
    chatProvider,
    {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }
  );
  context.subscriptions.push(registration);

  // Register commands
  const commands = [
    vscode.commands.registerCommand("perplexity-ai.ask", () =>
      askPerplexity(context)
    ),
    vscode.commands.registerCommand("perplexity-ai.testView", async () => {
      await vscode.commands.executeCommand(
        "workbench.view.extension.perplexity-chat"
      );
    }),
    vscode.commands.registerCommand("perplexity-ai.showView", async () => {
      try {
        await vscode.commands.executeCommand(
          "workbench.view.extension.perplexity-chat"
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
        await vscode.commands.executeCommand("perplexity-chatView.focus");
      } catch (error) {
        console.error("Error showing view:", error);
      }
    }),
    vscode.commands.registerCommand("perplexity-ai.askStreaming", () =>
      askPerplexityWithStreaming(context)
    ),
    vscode.commands.registerCommand("perplexity-ai.askWithFileContext", () =>
      askWithFileContext(context)
    ),
    vscode.commands.registerCommand(
      "perplexity-ai.askWithWorkspaceContext",
      () => askWithWorkspaceContext(context)
    ),
    vscode.commands.registerCommand("perplexity-ai.explainCode", () =>
      explainSelectedCode(context)
    ),
    vscode.commands.registerCommand("perplexity-ai.optimizeCode", () =>
      optimizeCode(context)
    ),
    vscode.commands.registerCommand("perplexity-ai.findBugs", () =>
      findBugs(context)
    ),
    vscode.commands.registerCommand("perplexity-ai.generateComments", () =>
      generateComments(context)
    ),
    vscode.commands.registerCommand("perplexity-ai.refactorCode", () =>
      refactorCode(context)
    ),
    vscode.commands.registerCommand("perplexity-ai.openSettings", () =>
      settingsProvider.show()
    ),
    vscode.commands.registerCommand("perplexity-ai.newChat", async () => {
      try {
        await vscode.commands.executeCommand(
          "workbench.view.extension.perplexity-chat"
        );
      } catch (error) {
        console.error("Could not show activity bar view container:", error);
      }
      // Wait a moment to ensure the view is ready
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        await vscode.commands.executeCommand("perplexity-chatView.focus");
      } catch (error) {
        console.error("Could not focus view:", error);
      }
      chatProvider.startNewChat();
    }),
    vscode.commands.registerCommand("perplexity-ai.clearHistory", () => {
      if (chatProvider.clearHistory) {
        chatProvider.clearHistory();
      } else {
        vscode.window.showInformationMessage("Chat history cleared!");
      }
    }),
    vscode.commands.registerCommand("perplexity-ai.chatHistory", () => {
      if (chatProvider.showChatHistory) {
        chatProvider.showChatHistory();
      } else {
        vscode.window.showInformationMessage(
          "Chat history feature not available!"
        );
      }
    }),
  ];

  context.subscriptions.push(...commands);
}

async function optimizeCode(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);

  if (!selectedText) {
    vscode.window.showWarningMessage("No code selected");
    return;
  }

  const apiKey = await getApiKey(context);
  if (!apiKey) {
    return;
  }

  const prompt = `Optimize this code for better performance and readability. Provide the optimized version with explanations:

\`\`\`${editor.document.languageId}
${selectedText}
\`\`\``;

  await executeCodeCommand(apiKey, prompt, "Code Optimization");
}

async function findBugs(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);

  if (!selectedText) {
    vscode.window.showWarningMessage("No code selected");
    return;
  }

  const apiKey = await getApiKey(context);
  if (!apiKey) {
    return;
  }

  const prompt = `Analyze this code for potential bugs, security issues, and code smells. Provide detailed explanations and fixes:

\`\`\`${editor.document.languageId}
${selectedText}
\`\`\``;

  await executeCodeCommand(apiKey, prompt, "Bug Analysis");
}

async function generateComments(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);

  if (!selectedText) {
    vscode.window.showWarningMessage("No code selected");
    return;
  }

  const apiKey = await getApiKey(context);
  if (!apiKey) {
    return;
  }

  const prompt = `Add comprehensive comments and documentation to this code. Include function descriptions, parameter explanations, and inline comments:

\`\`\`${editor.document.languageId}
${selectedText}
\`\`\``;

  await executeCodeCommand(apiKey, prompt, "Code Documentation");
}

async function refactorCode(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);

  if (!selectedText) {
    vscode.window.showWarningMessage("No code selected");
    return;
  }

  const apiKey = await getApiKey(context);
  if (!apiKey) {
    return;
  }

  const prompt = `Refactor this code following best practices. Improve code structure, naming conventions, and maintainability:

\`\`\`${editor.document.languageId}
${selectedText}
\`\`\``;

  await executeCodeCommand(apiKey, prompt, "Code Refactoring");
}

async function executeCodeCommand(
  apiKey: string,
  prompt: string,
  title: string
) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `${title} in progress...`,
      cancellable: false,
    },
    async (progress) => {
      try {
        const response = await queryPerplexityAPI(apiKey, prompt);
        showResponseInNewDocument(response, title);
      } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error}`);
      }
    }
  );
}

async function explainSelectedCode(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection);

  if (!selectedText) {
    vscode.window.showWarningMessage("No code selected");
    return;
  }

  const apiKey = await getApiKey(context);
  if (!apiKey) {
    return;
  }

  const prompt = `Explain this code in detail, including what it does, how it works, and any important concepts:

\`\`\`${editor.document.languageId}
${selectedText}
\`\`\``;

  await executeCodeCommand(apiKey, prompt, "Code Explanation");
}

async function getApiKey(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  let apiKey = await context.secrets.get("perplexity-api-key");

  if (!apiKey) {
    apiKey = await vscode.window.showInputBox({
      prompt: "Enter your Perplexity API Key",
      password: true,
      ignoreFocusOut: true,
    });

    if (apiKey) {
      await context.secrets.store("perplexity-api-key", apiKey);
    }
  }

  return apiKey;
}

async function askPerplexity(context: vscode.ExtensionContext) {
  const apiKey = await getApiKey(context);
  if (!apiKey) {
    vscode.window.showErrorMessage("API Key is required");
    return;
  }

  const question = await vscode.window.showInputBox({
    prompt: "Ask Perplexity AI anything...",
    ignoreFocusOut: true,
  });

  if (!question) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Querying Perplexity AI...",
      cancellable: false,
    },
    async (progress) => {
      try {
        const response = await queryPerplexityAPI(apiKey, question);
        showResponseInNewDocument(response, question);
      } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error}`);
      }
    }
  );
}

async function askPerplexityWithStreaming(context: vscode.ExtensionContext) {
  const apiKey = await getApiKey(context);
  if (!apiKey) {
    vscode.window.showErrorMessage("API Key is required");
    return;
  }

  const question = await vscode.window.showInputBox({
    prompt: "Ask Perplexity AI anything...",
    ignoreFocusOut: true,
  });

  if (!question) {
    return;
  }

  // Create a new document for streaming response
  const doc = await vscode.workspace.openTextDocument({
    content: `# ${question}\n\n`,
    language: "markdown",
  });

  const editor = await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
  });

  let responseContent = "";

  try {
    await queryPerplexityAPIStream(
      apiKey,
      question,
      // onChunk callback - called for each piece of text
      (chunk: string) => {
        responseContent += chunk;

        // Update the document with new content
        editor.edit((editBuilder) => {
          const fullContent = `# ${question}\n\n${responseContent}`;
          const fullRange = new vscode.Range(
            doc.positionAt(0),
            doc.positionAt(doc.getText().length)
          );
          editBuilder.replace(fullRange, fullContent);
        });

        // Auto-scroll to bottom
        const lastLine = editor.document.lineCount - 1;
        const lastPos = new vscode.Position(lastLine, 0);
        editor.revealRange(new vscode.Range(lastPos, lastPos));
      },
      // onComplete callback - called when streaming finishes
      () => {
        vscode.window.showInformationMessage("Response complete!");
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Streaming error: ${error}`);

    // Fallback to non-streaming if streaming fails
    try {
      const response = await queryPerplexityAPI(apiKey, question);
      const fallbackContent = `# ${question}\n\n${response}\n\n*Note: Streamed response failed, showing complete response*`;

      editor.edit((editBuilder) => {
        const fullRange = new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(doc.getText().length)
        );
        editBuilder.replace(fullRange, fallbackContent);
      });
    } catch (fallbackError) {
      vscode.window.showErrorMessage(
        `Complete request also failed: ${fallbackError}`
      );
    }
  }
}

async function askWithFileContext(context: vscode.ExtensionContext) {
  const apiKey = await getApiKey(context);
  if (!apiKey) {
    vscode.window.showErrorMessage("API Key is required");
    return;
  }

  const question = await vscode.window.showInputBox({
    prompt: "Ask about the current file...",
    ignoreFocusOut: true,
  });

  if (!question) {
    return;
  }

  const editor = vscode.window.activeTextEditor;
  let contextPrompt = question;

  if (editor) {
    const fileName = path.basename(editor.document.fileName);
    const fileContent = editor.document.getText();
    const language = editor.document.languageId;

    // Limit file content if too large
    const maxContentLength = 5000;
    const truncatedContent =
      fileContent.length > maxContentLength
        ? fileContent.substring(0, maxContentLength) +
          "\n\n... (file truncated)"
        : fileContent;

    contextPrompt = `I'm working on a ${language} file called "${fileName}". Here's the current file content:

\`\`\`${language}
${truncatedContent}
\`\`\`

Question: ${question}`;
  } else {
    vscode.window.showWarningMessage(
      "No active editor found. Using question without file context."
    );
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Analyzing file and querying Perplexity AI...",
      cancellable: false,
    },
    async (progress) => {
      try {
        const response = await queryPerplexityAPI(apiKey, contextPrompt);
        showResponseInNewDocument(response, `File Analysis: ${question}`);
      } catch (error) {
        vscode.window.showErrorMessage(`Error: ${error}`);
      }
    }
  );
}

async function askWithWorkspaceContext(context: vscode.ExtensionContext) {
  const apiKey = await getApiKey(context);
  if (!apiKey) {
    vscode.window.showErrorMessage("API Key is required");
    return;
  }

  const question = await vscode.window.showInputBox({
    prompt: "Ask about your workspace/project...",
    ignoreFocusOut: true,
  });

  if (!question) {
    return;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showWarningMessage("No workspace folder open");
    return;
  }

  try {
    const packageJsonUri = vscode.Uri.joinPath(
      workspaceFolders[0].uri,
      "package.json"
    );
    let projectInfo = "";

    try {
      const packageJson = await vscode.workspace.fs.readFile(packageJsonUri);
      const packageData = JSON.parse(packageJson.toString());
      projectInfo = `Project: ${packageData.name || "Unknown"}
Description: ${packageData.description || "No description"}
Version: ${packageData.version || "Unknown"}
Dependencies: ${
        Object.keys(packageData.dependencies || {}).join(", ") || "None"
      }
Dev Dependencies: ${
        Object.keys(packageData.devDependencies || {}).join(", ") || "None"
      }`;
    } catch {
      projectInfo =
        "No package.json found or unable to read project information";
    }

    // Get file structure (limited to prevent token overflow)
    const files = await vscode.workspace.findFiles(
      "**/*.{js,ts,jsx,tsx,py,java,cs,cpp,h,html,css,md,json}",
      "**/node_modules/**",
      50
    );

    const fileList = files
      .map((file) => path.relative(workspaceFolders[0].uri.fsPath, file.fsPath))
      .slice(0, 30) // Limit to first 30 files
      .join("\n");

    let readmeContent = "";
    try {
      const readmeUri = vscode.Uri.joinPath(
        workspaceFolders[0].uri,
        "README.md"
      );
      const readme = await vscode.workspace.fs.readFile(readmeUri);
      readmeContent = readme.toString().substring(0, 1000); // First 1000 chars
    } catch {}

    const contextPrompt = `I'm working on a project with the following information:

## Project Information
${projectInfo}

## Key Files in Project (showing up to 30 files)
${fileList}

${
  readmeContent
    ? `## README Content (first 1000 characters)\n${readmeContent}`
    : ""
}

## Question
${question}`;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Analyzing workspace and querying Perplexity AI...",
        cancellable: false,
      },
      async (progress) => {
        const response = await queryPerplexityAPI(apiKey, contextPrompt);
        showResponseInNewDocument(response, `Workspace Analysis: ${question}`);
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Error analyzing workspace: ${error}`);
  }
}

async function queryPerplexityAPIStream(
  apiKey: string,
  prompt: string,
  onChunk: (chunk: string) => void,
  onComplete?: () => void
): Promise<void> {
  const config = vscode.workspace.getConfiguration("perplexityAI");
  const model = config.get<string>("model", "sonar");
  const maxTokens = config.get<number>("maxTokens", 1000);

  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.2,
        stream: true, // Enable streaming
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API request failed: ${response.status} ${response.statusText}\nDetails: ${errorText}`
      );
    }

    // Check if response body exists
    if (!response.body) {
      throw new Error("Response body is null");
    }

    // Create a reader for the stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          onComplete?.();
          break;
        }

        // Decode the chunk
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        // Process each line
        for (const line of lines) {
          if (line.startsWith("data: ") && !line.includes("[DONE]")) {
            try {
              const jsonStr = line.slice(6); // Remove 'data: ' prefix
              if (jsonStr.trim()) {
                const data = JSON.parse(jsonStr);
                const content = data.choices?.[0]?.delta?.content;
                if (content) {
                  onChunk(content);
                }
              }
            } catch (parseError) {
              // Ignore JSON parsing errors for incomplete chunks
              console.warn("Failed to parse streaming chunk:", parseError);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    throw new Error(`Failed to stream from Perplexity API: ${error}`);
  }
}

// API call to Perplexity
async function queryPerplexityAPI(
  apiKey: string,
  prompt: string
): Promise<string> {
  const config = vscode.workspace.getConfiguration("perplexityAI");
  const model = config.get<string>("model", "sonar");
  const maxTokens = config.get<number>("maxTokens", 1000);

  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: `sonar`,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.2,
        stream: false,
      }),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`API Error Response: ${errorBody}`);
      throw new Error(errorBody);
    }

    const data = (await response.json()) as PerplexityResponse;
    return data.choices[0]?.message?.content || "No response received";
  } catch (error) {
    throw new Error(`Failed to query Perplexity API - ${error}`);
  }
}
// Show response in new document
async function showResponseInNewDocument(content: string, title: string) {
  const doc = await vscode.workspace.openTextDocument({
    content: `# ${title}\n\n${content}`,
    language: "markdown",
  });

  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
  });
}

// Chat view provider (basic implementation)
class PerplexityChatProvider implements vscode.TreeDataProvider<ChatItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    ChatItem | undefined | null | void
  > = new vscode.EventEmitter<ChatItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    ChatItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  constructor(private context: vscode.ExtensionContext) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ChatItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ChatItem): Thenable<ChatItem[]> {
    if (!element) {
      return Promise.resolve([
        new ChatItem(
          "Start a new conversation",
          "Click to ask Perplexity AI",
          vscode.TreeItemCollapsibleState.None
        ),
      ]);
    }
    return Promise.resolve([]);
  }
}

class ChatItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly tooltip: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.tooltip = tooltip;
  }
}

interface PerplexityResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

// This method is called when your extension is deactivated
export function deactivate() {}
