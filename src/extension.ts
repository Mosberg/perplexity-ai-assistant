import * as vscode from "vscode";
import { PerplexityCustomChatProvider } from "./chatProvider";
import { CodeActionsProvider } from "./codeActionsProvider";
import { CommitAssistant } from "./commitAssistant";
import { PerplexityCompletionProvider } from "./completionProvider";
import { PerplexitySettingsProvider } from "./settingsProvider";

// Removed local stub classes for CodeActionsProvider, CommitAssistant, and PerplexityCompletionProvider
// Using imported implementations instead

// The following imports are now used directly
// import { CodeActionsProvider } from "./codeActionsProvider";
// import { CommitAssistant } from "./commitAssistant";
// import { PerplexityCompletionProvider } from "./completionProvider";

let chatViewRegistered = false;

export function activate(context: vscode.ExtensionContext) {
  console.log("Perplexity AI Assistant is now active!");

  vscode.commands.executeCommand("setContext", "perplexity-ai.enabled", true);

  // Initialize Providers
  const chatProvider = new PerplexityCustomChatProvider(
    context.extensionUri,
    context
  );
  const settingsProvider = new PerplexitySettingsProvider(
    context.extensionUri,
    context
  );
  const completionProvider = new PerplexityCompletionProvider(context);
  const commitAssistant = new CommitAssistant(context);
  const codeActionsProvider = new CodeActionsProvider(context);

  // Register Chat View Provider
  if (!chatViewRegistered) {
    const registration = vscode.window.registerWebviewViewProvider(
      PerplexityCustomChatProvider.viewType,
      chatProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    );
    context.subscriptions.push(registration);
    chatViewRegistered = true;
  }

  // Register Inline Completion Provider
  const completionDisposable =
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: "**" },
      completionProvider
    );
  context.subscriptions.push(completionDisposable);

  // Register Code Actions Provider
  const codeActionsDisposable = vscode.languages.registerCodeActionsProvider(
    { pattern: "**" },
    codeActionsProvider,
    {
      providedCodeActionKinds: CodeActionsProvider.providedCodeActionKinds,
    }
  );
  context.subscriptions.push(codeActionsDisposable);

  // Register Commands
  const commands = [
    // Chat Commands
    vscode.commands.registerCommand("perplexity-ai.ask", () =>
      askPerplexity(context)
    ),
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

    // Code Actions
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
    vscode.commands.registerCommand("perplexity-ai.generateTests", () =>
      generateTests(context)
    ),
    vscode.commands.registerCommand("perplexity-ai.convertCode", () =>
      convertCode(context)
    ),
    vscode.commands.registerCommand("perplexity-ai.reviewCode", () =>
      reviewCode(context)
    ),

    // Completion Commands
    vscode.commands.registerCommand("perplexity-ai.enableCompletion", () => {
      vscode.workspace
        .getConfiguration("perplexityAI")
        .update("completionEnabled", true, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        "Perplexity inline completions enabled"
      );
    }),
    vscode.commands.registerCommand("perplexity-ai.disableCompletion", () => {
      vscode.workspace
        .getConfiguration("perplexityAI")
        .update("completionEnabled", false, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        "Perplexity inline completions disabled"
      );
    }),

    // Commit Assistant Commands
    vscode.commands.registerCommand("perplexity-ai.generateCommit", () =>
      commitAssistant.generateCommitMessage()
    ),
    vscode.commands.registerCommand(
      "perplexity-ai.generateCommitForStaged",
      () => commitAssistant.generateCommitForStaged()
    ),
    vscode.commands.registerCommand("perplexity-ai.analyzeChanges", () =>
      commitAssistant.analyzeChanges()
    ),

    // Session Management
    vscode.commands.registerCommand("perplexity-ai.newChat", async () => {
      try {
        await vscode.commands.executeCommand(
          "workbench.view.extension.perplexity-chat"
        );
      } catch (error) {
        console.error("Could not show activity bar view container:", error);
      }
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
    // Remove exportCurrentChat if not implemented in chatProvider
    // vscode.commands.registerCommand("perplexity-ai.exportChat", () =>
    //   chatProvider.exportCurrentChat()
    // ),
    vscode.commands.registerCommand("perplexity-ai.openSettings", () =>
      settingsProvider.show()
    ),

    // Model Selection
    vscode.commands.registerCommand("perplexity-ai.selectModel", () =>
      selectModel(context)
    ),
  ];

  context.subscriptions.push(...commands);

  // Status Bar Item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = "$(hubot) Perplexity";
  statusBarItem.tooltip = "Click to open Perplexity AI";
  statusBarItem.command = "perplexity-ai.newChat";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

// Model Selection
async function selectModel(_context: vscode.ExtensionContext) {
  const models = [
    { label: "sonar", description: "Fast and cost-effective", model: "sonar" },
    {
      label: "sonar-pro",
      description: "Enhanced capabilities",
      model: "sonar-pro",
    },
    {
      label: "sonar-reasoning",
      description: "Advanced reasoning",
      model: "sonar-reasoning",
    },
    {
      label: "llama-3.1-sonar-small-128k-online",
      description: "Small context window",
      model: "llama-3.1-sonar-small-128k-online",
    },
    {
      label: "llama-3.1-sonar-large-128k-online",
      description: "Large context window",
      model: "llama-3.1-sonar-large-128k-online",
    },
    {
      label: "llama-3.1-sonar-huge-128k-online",
      description: "Huge context window",
      model: "llama-3.1-sonar-huge-128k-online",
    },
  ];

  const selected = await vscode.window.showQuickPick(models, {
    placeHolder: "Select Perplexity AI Model",
  });

  if (selected) {
    await vscode.workspace
      .getConfiguration("perplexityAI")
      .update("model", selected.model, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Model changed to: ${selected.label}`);
  }
}

// Generate Tests
async function generateTests(context: vscode.ExtensionContext) {
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

  const prompt = `Generate comprehensive unit tests for this code. Use appropriate testing framework for the language:\n\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;
  await executeCodeCommand(apiKey, prompt, "Test Generation");
}

// Convert Code
async function convertCode(context: vscode.ExtensionContext) {
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

  const targetLanguage = await vscode.window.showInputBox({
    prompt: "Target programming language",
    placeHolder: "e.g., Python, Java, TypeScript",
  });

  if (!targetLanguage) {
    return;
  }

  const apiKey = await getApiKey(context);
  if (!apiKey) {
    return;
  }

  const prompt = `Convert this ${editor.document.languageId} code to ${targetLanguage}. Maintain functionality and add comments explaining the conversion:\n\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;
  await executeCodeCommand(apiKey, prompt, "Code Conversion");
}

// Review Code
async function reviewCode(context: vscode.ExtensionContext) {
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

  const prompt = `Provide a comprehensive code review for this code. Include:\n1. Code quality assessment\n2. Best practices adherence\n3. Performance considerations\n4. Security concerns\n5. Suggestions for improvement\n\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;
  await executeCodeCommand(apiKey, prompt, "Code Review");
}

// Existing functions (optimizeCode, findBugs, etc.)
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

  const prompt = `Optimize this code for better performance and readability. Provide the optimized version with explanations:\n\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;
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

  const prompt = `Analyze this code for potential bugs, security issues, and code smells. Provide detailed explanations and fixes:\n\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;
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

  const prompt = `Add comprehensive comments and documentation to this code. Include function descriptions, parameter explanations, and inline comments:\n\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;
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

  const prompt = `Refactor this code following best practices. Improve code structure, naming conventions, and maintainability:\n\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;
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

  const prompt = `Explain this code in detail, including what it does, how it works, and any important concepts:\n\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;
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
    async (_progress) => {
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
      (chunk: string) => {
        responseContent += chunk;
        editor.edit((editBuilder) => {
          const fullContent = `# ${question}\n\n${responseContent}`;
          const fullRange = new vscode.Range(
            doc.positionAt(0),
            doc.positionAt(doc.getText().length)
          );
          editBuilder.replace(fullRange, fullContent);
        });

        const lastLine = editor.document.lineCount - 1;
        const lastPos = new vscode.Position(lastLine, 0);
        editor.revealRange(new vscode.Range(lastPos, lastPos));
      },
      () => {
        vscode.window.showInformationMessage("Response complete!");
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Streaming error: ${error}`);
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
    const fileName = editor.document.fileName.split("/").pop() || "file";
    const fileContent = editor.document.getText();
    const language = editor.document.languageId;
    const maxContentLength = 5000;

    const truncatedContent =
      fileContent.length > maxContentLength
        ? fileContent.substring(0, maxContentLength) +
          "\n\n... (file truncated)"
        : fileContent;

    contextPrompt = `I'm working on a ${language} file called "${fileName}". Here's the current file content:\n\n\`\`\`${language}\n${truncatedContent}\n\`\`\`\n\nQuestion: ${question}`;
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
    async (_progress) => {
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
      projectInfo = `Project: ${packageData.name || "Unknown"}\nDescription: ${packageData.description || "No description"}\nVersion: ${packageData.version || "Unknown"}\nDependencies: ${Object.keys(packageData.dependencies || {}).join(", ") || "None"}\nDev Dependencies: ${Object.keys(packageData.devDependencies || {}).join(", ") || "None"}`;
    } catch {
      projectInfo =
        "No package.json found or unable to read project information";
    }

    const files = await vscode.workspace.findFiles(
      "**/*.{js,ts,jsx,tsx,py,java,cs,cpp,h,html,css,md,json}",
      "**/node_modules/**",
      50
    );

    const fileList = files
      .map((file) => vscode.workspace.asRelativePath(file))
      .slice(0, 30)
      .join("\n");

    let readmeContent = "";
    try {
      const readmeUri = vscode.Uri.joinPath(
        workspaceFolders[0].uri,
        "README.md"
      );
      const readme = await vscode.workspace.fs.readFile(readmeUri);
      readmeContent = readme.toString().substring(0, 2000);
    } catch {}

    const contextPrompt = `I'm working on a project with the following information:\n\n## Project Information\n${projectInfo}\n\n## Key Files in Project (showing up to 30 files)\n${fileList}\n\n${readmeContent ? `## README Content (first 2000 characters)\n${readmeContent}` : ""}\n\n## Question\n${question}`;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Analyzing workspace and querying Perplexity AI...",
        cancellable: false,
      },
      async (_progress) => {
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
  const model = config.get("model", "sonar");
  const maxTokens = config.get("maxTokens", 2000);

  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        contentType: "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        maxTokens: maxTokens,
        temperature: 0.2,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API request failed: ${response.status} ${response.statusText}\nDetails: ${errorText}`
      );
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          onComplete?.();
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ") && !line.includes("[DONE]")) {
            try {
              const jsonStr = line.slice(6);
              if (jsonStr.trim()) {
                const data = JSON.parse(jsonStr);
                const content = data.choices?.[0]?.delta?.content;
                if (content) {
                  onChunk(content);
                }
              }
            } catch {
              // Ignore JSON parsing errors for incomplete chunks
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

async function queryPerplexityAPI(
  apiKey: string,
  prompt: string
): Promise<string> {
  const config = vscode.workspace.getConfiguration("perplexityAI");
  const model = config.get("model", "sonar");
  const maxTokens = config.get("maxTokens", 2000);

  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.2,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(errorBody);
    }

    const data = (await response.json()) as PerplexityResponse;
    return data.choices[0]?.message?.content || "No response received";
  } catch (error) {
    throw new Error(`Failed to query Perplexity API - ${error}`);
  }
}

async function showResponseInNewDocument(content: string, title: string) {
  const doc = await vscode.workspace.openTextDocument({
    content: `# ${title}\n\n${content}`,
    language: "markdown",
  });

  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
  });
}

interface PerplexityResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export function deactivate() {}
