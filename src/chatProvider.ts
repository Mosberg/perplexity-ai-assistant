import * as vscode from "vscode";
import * as fs from "fs";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
}

interface AttachedContext {
  id: string;
  type: "file" | "selection";
  name?: string;
  path?: string;
  content: string;
  language?: string;
  extension?: string;
  iconUri?: string;
  lineCount?: number;
  startLine?: number;
  endLine?: number;
  fileName?: string;
}

export class PerplexityCustomChatProvider
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "perplexity-chatView";
  private view?: vscode.WebviewView;
  private sessions: ChatSession[] = [];
  private currentSessionId?: string;
  private currentMode = "ask";
  private currentModel = "sonar";
  private abortController?: AbortController;
  private attachedContext: AttachedContext[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    this.loadChatHistory();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      try {
        switch (data.type) {
          case "sendMessage":
            await this.handleUserMessage(data.value);
            break;
          case "stopGeneration":
            this.stopGeneration();
            break;
          case "newChat":
            this.startNewChat();
            break;
          case "clearHistory":
            this.clearHistory();
            break;
          case "selectSession":
            this.selectSession(data.value);
            break;
          case "copyToClipboard":
            await vscode.env.clipboard.writeText(data.value);
            vscode.window.showInformationMessage("Copied to clipboard");
            break;
          case "insertAtCursor":
            await this.insertAtCursor(data.value);
            break;
          case "modeChange":
            this.handleModeChange(data.mode);
            break;
          case "modelChange":
            this.handleModelChange(data.model);
            break;
          case "autoDetectContext":
            await this.handleAutoDetectContext();
            break;
          case "requestAdditionalContext":
            await this.handleRequestAdditionalContext();
            break;
          case "removeContext":
            this.handleRemoveContext(data.contextId);
            break;
        }
      } catch (err) {
        console.error("Error handling webview message:", err);
      }
    });

    setTimeout(() => {
      this.updateWebview();
      this.handleAutoDetectContext();
    }, 100);
  }

  private async handleUserMessage(message: string) {
    if (!message.trim()) {
      return;
    }

    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    try {
      const apiKey = await this.getApiKey();
      if (!apiKey) {
        this.view?.webview.postMessage({
          type: "error",
          error:
            "API key not configured. Please set up your Perplexity API key.",
        });
        return;
      }

      this.view?.webview.postMessage({ type: "showTyping" });

      let fullMessage = message;
      if (this.attachedContext.length > 0) {
        const contextStrings = this.attachedContext.map((ctx) => {
          if (ctx.type === "file") {
            return `File: ${ctx.name}\n\`\`\`${ctx.language}\n${ctx.content}\n\`\`\``;
          } else if (ctx.type === "selection") {
            return `Selected code from ${ctx.fileName} (lines ${ctx.startLine}-${ctx.endLine}):\n\`\`\`\n${ctx.content}\n\`\`\``;
          }
          return `Context: ${ctx.name}\n${ctx.content}`;
        });
        fullMessage = `Context:\n${contextStrings.join(
          "\n\n"
        )}\n\nUser Question: ${message}`;
      }

      const response = await this.queryPerplexityAPI(
        apiKey,
        fullMessage,
        this.abortController.signal
      );

      this.view?.webview.postMessage({ type: "hideTyping" });

      this.addUserMessage(message);
      this.addAssistantMessage(response);
    } catch (err: unknown) {
      this.view?.webview.postMessage({ type: "hideTyping" });

      if (err instanceof Error && err.name === "AbortError") {
        this.view?.webview.postMessage({ type: "responseStopped" });
      } else {
        this.view?.webview.postMessage({
          type: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    } finally {
      this.abortController = undefined;
    }
  }

  private addAssistantMessage(content: string) {
    this.ensureCurrentSession();
    const session = this.sessions.find((s) => s.id === this.currentSessionId);
    if (!session) {
      return;
    }

    session.messages.push({
      role: "assistant",
      content,
      timestamp: new Date(),
    });

    this.updateWebview();
    this.saveChatHistory();
  }

  private addUserMessage(content: string) {
    this.ensureCurrentSession();
    let session = this.sessions.find((s) => s.id === this.currentSessionId);

    if (!session) {
      session = {
        id: this.currentSessionId!,
        title: content.length > 50 ? content.substring(0, 50) + "..." : content,
        messages: [],
        createdAt: new Date(),
      };
      this.sessions.unshift(session);
    }

    session.messages.push({
      role: "user",
      content,
      timestamp: new Date(),
    });

    if (session.messages.length === 1) {
      session.title =
        content.length > 50 ? content.substring(0, 50) + "..." : content;
    }

    this.updateWebview();
    this.saveChatHistory();
  }

  private ensureCurrentSession() {
    if (
      !this.currentSessionId ||
      !this.sessions.find((s) => s.id === this.currentSessionId)
    ) {
      this.currentSessionId =
        Date.now().toString() + Math.random().toString(36).substr(2, 9);
    }
  }

  public startNewChat() {
    this.currentSessionId =
      Date.now().toString() + Math.random().toString(36).substr(2, 9);
    this.updateWebview();
  }

  public stopGeneration() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
      this.view?.webview.postMessage({ type: "responseStopped" });
    }
  }

  public clearHistory() {
    this.sessions = [];
    this.currentSessionId = undefined;
    this.updateWebview();
    this.saveChatHistory();
  }

  public async showChatHistory() {
    if (this.sessions.length === 0) {
      vscode.window.showInformationMessage("No chat history available.");
      return;
    }

    const items = this.sessions.map((session) => {
      const createdAt =
        session.createdAt instanceof Date
          ? session.createdAt
          : new Date(session.createdAt);

      return {
        label: session.title,
        description: `${session.messages.length} messages`,
        detail: `Created: ${createdAt.toLocaleDateString()} ${createdAt.toLocaleTimeString()}`,
        session,
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a chat session to view",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected) {
      this.selectSession(selected.session.id);

      const userMessages = selected.session.messages.filter(
        (m) => m.role === "user"
      ).length;
      const assistantMessages = selected.session.messages.filter(
        (m) => m.role === "assistant"
      ).length;

      vscode.window.showInformationMessage(
        `Loaded chat session: ${selected.session.title} (${userMessages} questions, ${assistantMessages} responses)`
      );
    }
  }

  public selectSession(sessionId: string) {
    if (this.sessions.find((s) => s.id === sessionId)) {
      this.currentSessionId = sessionId;
      this.updateWebview();
    }
  }

  private updateWebview(showTyping = false) {
    if (!this.view || !this.view.webview) {
      return;
    }

    try {
      const session = this.sessions.find((s) => s.id === this.currentSessionId);

      this.view.webview.postMessage({
        type: "updateChat",
        messages: session?.messages || [],
        sessions: this.sessions.map((s) => ({ id: s.id, title: s.title })),
        currentSessionId: this.currentSessionId,
        showTyping,
      });
    } catch (err) {
      console.error("Error updating webview:", err);
    }
  }

  private async insertAtCursor(text: string) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const selection = editor.selection;
      await editor.edit((editBuilder) => {
        editBuilder.replace(selection, text);
      });
    }
  }

  private handleModeChange(mode: string) {
    this.currentMode = mode;
  }

  private handleModelChange(model: string) {
    this.currentModel = model;
    const config = vscode.workspace.getConfiguration("perplexityAI");
    config.update("model", model, vscode.ConfigurationTarget.Global);
  }

  private async getApiKey(): Promise<string | undefined> {
    return await this.context.secrets.get("perplexity-api-key");
  }

  private async queryPerplexityAPI(
    apiKey: string,
    prompt: string,
    signal?: AbortSignal
  ): Promise<string> {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.currentModel,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 2000,
        temperature: 0.2,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    if (!response.body) {
      return "No response received";
    } else {
      const data = (await response.json()) as {
        choices: { message: { content: string } }[];
      };
      return data.choices[0]?.message?.content || "No response received";
    }
  }

  private saveChatHistory() {
    this.context.globalState.update("perplexity-chat-history", this.sessions);
  }

  private loadChatHistory() {
    const saved = this.context.globalState.get<ChatSession[]>(
      "perplexity-chat-history",
      []
    );

    this.sessions = saved.map((session) => ({
      ...session,
      createdAt:
        session.createdAt instanceof Date
          ? session.createdAt
          : new Date(session.createdAt),
      messages: session.messages.map((message) => ({
        ...message,
        timestamp:
          message.timestamp instanceof Date
            ? message.timestamp
            : new Date(message.timestamp),
      })),
    }));

    this.currentSessionId =
      this.sessions.length > 0 ? this.sessions[0].id : undefined;
  }

  private async handleAutoDetectContext() {
    try {
      if (this.attachedContext.length > 0) {
        return;
      }

      const currentFile = await this.getCurrentFileContext();
      if (currentFile) {
        this.attachedContext.push(currentFile);
      }

      const selection = await this.getSelectionContext();
      if (selection) {
        this.attachedContext.push(selection);
      }

      this.view?.webview.postMessage({
        type: "contextAttached",
        context: this.attachedContext,
      });
    } catch (err) {
      console.error("Error auto-detecting context:", err);
    }
  }

  private async handleRequestAdditionalContext() {
    try {
      const items: vscode.QuickPickItem[] = [];

      const openEditors = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter((tab) => tab.input instanceof vscode.TabInputText)
        .map((tab) => tab.input as vscode.TabInputText);

      if (openEditors.length > 0) {
        items.push({
          label: "Open Editors",
          kind: vscode.QuickPickItemKind.Separator,
        });

        for (const editor of openEditors) {
          const fileName =
            editor.uri.path.split("/").pop() ||
            editor.uri.path.split("\\").pop() ||
            editor.uri.path;
          const relativePath = vscode.workspace.asRelativePath(editor.uri);

          items.push({
            label: `$(file) ${fileName}`,
            description: relativePath !== fileName ? relativePath : "",
            detail: editor.uri.fsPath,
            iconPath: new vscode.ThemeIcon("file"),
          });
        }
      }

      items.push({
        label: "Files & Folders...",
        kind: vscode.QuickPickItemKind.Separator,
      });

      items.push({
        label: "$(folder-opened) Browse Files...",
        description: "Open file browser",
        detail: "Select files from file system",
      });

      if (
        vscode.workspace.workspaceFolders &&
        vscode.workspace.workspaceFolders.length > 0
      ) {
        try {
          const workspaceFiles = await vscode.workspace.findFiles(
            "**/*.{js,ts,py,java,cpp,c,cs,php,rb,go,rs,html,css,scss,vue,jsx,tsx,json,md,txt}",
            "**/node_modules/**",
            20
          );

          if (workspaceFiles.length > 0) {
            items.push({
              label: "Recent Files",
              kind: vscode.QuickPickItemKind.Separator,
            });

            for (const file of workspaceFiles.slice(0, 15)) {
              const fileName =
                file.path.split("/").pop() ||
                file.path.split("\\").pop() ||
                file.path;
              const relativePath = vscode.workspace.asRelativePath(file);

              items.push({
                label: `$(file) ${fileName}`,
                description: relativePath,
                detail: file.fsPath,
                iconPath: new vscode.ThemeIcon("file"),
              });
            }
          }
        } catch (err) {
          console.warn("Could not load workspace files:", err);
        }
      }

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Search for files and context to add to your request",
        matchOnDescription: true,
        matchOnDetail: true,
        canPickMany: false,
      });

      if (selected) {
        if (selected.label === "$(folder-opened) Browse Files...") {
          await this.showFileBrowser();
        } else if (selected.detail && selected.label.includes("$(file)")) {
          await this.addFileToContext(selected.detail);
        }
      }
    } catch (err) {
      console.error("Error showing context picker:", err);
      vscode.window.showErrorMessage("Failed to show context picker");
    }
  }

  private async showFileBrowser() {
    const files = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: false,
      openLabel: "Add to Context",
      title: "Add additional files to context",
      filters: {
        codeFiles: [
          "js",
          "ts",
          "py",
          "java",
          "cpp",
          "c",
          "cs",
          "php",
          "rb",
          "go",
          "rs",
        ],
        webFiles: ["html", "css", "scss", "less", "vue", "jsx", "tsx"],
        configFiles: ["json", "yaml", "yml", "xml", "toml", "ini"],
        documentation: ["md", "txt", "rst"],
        allFiles: ["*"],
      },
    });

    if (files && files.length > 0) {
      for (const file of files) {
        await this.addFileToContext(file.fsPath);
      }
    }
  }

  private async addFileToContext(filePath: string) {
    try {
      const existingFile = this.attachedContext.find(
        (ctx) => ctx.type === "file" && ctx.path === filePath
      );
      if (!existingFile) {
        const content = await vscode.workspace.fs.readFile(
          vscode.Uri.file(filePath)
        );
        const fileName = filePath.includes("\\")
          ? filePath.split("\\").pop()
          : filePath.split("/").pop() || filePath;

        const fileUri = vscode.Uri.file(filePath);
        const iconUri = await this.getFileIconUri(fileUri);

        this.attachedContext.push({
          id: Date.now().toString() + Math.random(),
          type: "file",
          name: fileName,
          path: filePath,
          content: content.toString(),
          language: this.getLanguageFromExtension(fileName || ""),
          extension: (fileName || "").split(".").pop() || "",
          iconUri,
        });

        this.view?.webview.postMessage({
          type: "contextAttached",
          context: this.attachedContext,
        });
      }
    } catch (err) {
      console.error(`Error reading file ${filePath}:`, err);
      vscode.window.showErrorMessage(`Failed to read file: ${filePath}`);
    }
  }

  private async getCurrentFileContext(): Promise<AttachedContext | null> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return null;
    }

    const document = editor.document;
    const fullPath = document.fileName;
    const fileName = fullPath.includes("\\")
      ? fullPath.split("\\").pop()
      : fullPath.split("/").pop() || fullPath;

    const fileUri = vscode.Uri.file(document.fileName);
    const iconUri = await this.getFileIconUri(fileUri);

    return {
      id: Date.now().toString(),
      type: "file",
      name: fileName,
      path: document.fileName,
      content: document.getText(),
      language: document.languageId,
      extension: (fileName || "").split(".").pop() || "",
      iconUri,
    };
  }

  private async getSelectionContext(): Promise<AttachedContext | null> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return null;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
      return null;
    }

    const selectedText = editor.document.getText(selection);
    const lineCount = selection.end.line - selection.start.line + 1;
    const fileName =
      editor.document.fileName.split("/").pop() ||
      editor.document.fileName.split("\\").pop() ||
      editor.document.fileName;

    return {
      id: Date.now().toString(),
      type: "selection",
      content: selectedText,
      lineCount,
      startLine: selection.start.line + 1,
      endLine: selection.end.line + 1,
      fileName,
    };
  }

  private getLanguageFromExtension(fileName: string): string {
    const ext = fileName.split(".").pop()?.toLowerCase();
    const languageMap: { [key: string]: string } = {
      js: "javascript",
      ts: "typescript",
      py: "python",
      java: "java",
      cpp: "cpp",
      c: "c",
      cs: "csharp",
      php: "php",
      rb: "ruby",
      go: "go",
      rs: "rust",
      html: "html",
      css: "css",
      json: "json",
      xml: "xml",
      md: "markdown",
    };
    return languageMap[ext || ""] || "plaintext";
  }

  private async getFileIconUri(
    fileUri: vscode.Uri
  ): Promise<string | undefined> {
    try {
      const fileName = fileUri.path.split("/").pop() || "";
      const extension = fileName.split(".").pop()?.toLowerCase() || "";

      const allExtensions = vscode.extensions.all;
      let materialIconExt =
        allExtensions.find((ext) => ext.id === "pkief.material-icon-theme") ||
        allExtensions.find(
          (ext) => ext.packageJSON?.name === "material-icon-theme"
        ) ||
        allExtensions.find((ext) =>
          ext.packageJSON?.displayName?.includes("Material Icon Theme")
        );

      if (materialIconExt && !materialIconExt.isActive) {
        await materialIconExt.activate();
      }

      if (!materialIconExt || !this.view) {
        const testSvg = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="16" height="16" fill="#007ACC"/>
            <text x="8" y="12" text-anchor="middle" fill="white" font-size="10" font-family="Arial">${extension
              .charAt(0)
              .toUpperCase()}</text>
          </svg>`;
        return `data:image/svg+xml;base64,${Buffer.from(testSvg).toString("base64")}`;
      }

      const materialIconMap: { [key: string]: string } = {
        ts: "typescript",
        js: "javascript",
        py: "python",
        java: "java",
        cpp: "cpp",
        c: "c",
        cs: "csharp",
        php: "php",
        rb: "ruby",
        go: "go",
        rs: "rust",
        html: "html",
        css: "css",
        scss: "sass",
        json: "json",
        xml: "xml",
        md: "markdown",
        jsx: "react",
        tsx: "react_ts",
        vue: "vue",
      };

      const lowerFileName = fileName.toLowerCase();
      let iconName = "";
      if (lowerFileName === "package.json") {
        iconName = "nodejs";
      } else if (lowerFileName === "readme.md") {
        iconName = "markdown";
      } else if (lowerFileName.includes("dockerfile")) {
        iconName = "docker";
      } else if (
        lowerFileName.endsWith(".config.js") ||
        lowerFileName.endsWith(".config.ts")
      ) {
        iconName = "settings";
      } else {
        iconName = materialIconMap[extension] || "file";
      }

      const iconPath = vscode.Uri.joinPath(
        materialIconExt.extensionUri,
        "icons",
        `${iconName}.svg`
      );

      try {
        await vscode.workspace.fs.stat(iconPath);
      } catch {
        const fallbackIconPath = vscode.Uri.joinPath(
          materialIconExt.extensionUri,
          "icons",
          "file.svg"
        );
        try {
          await vscode.workspace.fs.stat(fallbackIconPath);
          return this.view.webview.asWebviewUri(fallbackIconPath).toString();
        } catch {
          const testSvg = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="16" height="16" fill="#666"/>
            <text x="8" y="12" text-anchor="middle" fill="white" font-size="8" font-family="Arial">${extension
              .charAt(0)
              .toUpperCase()}</text>
          </svg>`;
          return `data:image/svg+xml;base64,${Buffer.from(testSvg).toString("base64")}`;
        }
      }

      return this.view.webview.asWebviewUri(iconPath).toString();
    } catch {
      if (this.view) {
        const fileName = fileUri.path.split("/").pop() || "";
        const extension = fileName.split(".").pop()?.toLowerCase() || "";
        const testSvg = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="16" height="16" fill="#ff6b6b"/>
          <text x="8" y="12" text-anchor="middle" fill="white" font-size="8" font-family="Arial">${extension
            .charAt(0)
            .toUpperCase()}</text>
        </svg>`;
        return `data:image/svg+xml;base64,${Buffer.from(testSvg).toString("base64")}`;
      }
    }
    return undefined;
  }

  private handleRemoveContext(contextId: string) {
    this.attachedContext = this.attachedContext.filter(
      (ctx) => ctx.id !== contextId
    );
    this.view?.webview.postMessage({
      type: "contextAttached",
      context: this.attachedContext,
    });
  }

  private getHtmlForWebview(webview: vscode.Webview) {
    const nonce = getNonce();
    const webviewPath = vscode.Uri.joinPath(
      this.extensionUri,
      "src",
      "chat-view"
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(webviewPath, "styles.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(webviewPath, "script.js")
    );
    const htmlPath = vscode.Uri.joinPath(webviewPath, "index.html");

    try {
      const htmlContent = fs.readFileSync(htmlPath.fsPath, "utf8");
      return htmlContent
        .replace("{{CSS_URI}}", styleUri.toString())
        .replace("{{JS_URI}}", scriptUri.toString())
        .replace("{{NONCE}}", nonce);
    } catch (err) {
      console.error("Error loading webview files:", err);
      return this.getFallbackHtml(webview, nonce);
    }
  }

  private getFallbackHtml(webview: vscode.Webview, nonce: string) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Perplexity AI Chat</title>
        <style>
            body { 
                font-family: var(--vscode-font-family); 
                padding: 20px; 
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
            }
        </style>
    </head>
    <body>
        <h3>Error loading webview files</h3>
        <p>Please check that the webview files exist in src/chatview/</p>
    </body>
    </html>`;
  }
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
