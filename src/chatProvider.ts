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

export class PerplexityCustomChatProvider
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "perplexity-chatView";
  private _view?: vscode.WebviewView;
  private _sessions: ChatSession[] = [];
  private _currentSessionId?: string;
  private _currentMode: string = "ask";
  private _currentModel: string = "sonar";
  private _abortController?: AbortController;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    this.loadChatHistory();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from webview
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
      } catch (error) {
        console.error("Error handling webview message:", error);
      }
    });

    // Load existing chat on startup
    setTimeout(() => {
      this.updateWebview();
      // Auto-detect context on startup
      this.handleAutoDetectContext();
    }, 100);
  }

  private async handleUserMessage(message: string) {
    if (!message.trim()) {
      return;
    }

    // Cancel any ongoing request
    if (this._abortController) {
      this._abortController.abort();
    }

    // Create new abort controller for this request
    this._abortController = new AbortController();

    try {
      const apiKey = await this.getApiKey();
      if (!apiKey) {
        this._view?.webview.postMessage({
          type: "error",
          error:
            "API key not configured. Please set up your Perplexity API key.",
        });
        return;
      }

      // Show typing indicator
      this._view?.webview.postMessage({
        type: "showTyping",
      });

      // Prepare message with context
      let fullMessage = message;
      if (this.attachedContext.length > 0) {
        const contextStrings = this.attachedContext.map((ctx) => {
          switch (ctx.type) {
            case "file":
              return `File: ${ctx.name}\n\`\`\`${ctx.language}\n${ctx.content}\n\`\`\``;
            case "selection":
              return `Selected code from ${ctx.fileName} (lines ${ctx.startLine}-${ctx.endLine}):\n\`\`\`\n${ctx.content}\n\`\`\``;
            default:
              return `Context: ${ctx.name}\n${ctx.content}`;
          }
        });

        fullMessage = `Context:\n${contextStrings.join(
          "\n\n"
        )}\n\nUser Question: ${message}`;

        // Keep attached context - don't clear it automatically
        // Context will persist for future questions unless manually removed
      }

      const response = await this.queryPerplexityAPI(
        apiKey,
        fullMessage,
        this._abortController.signal
      );

      // Hide typing indicator
      this._view?.webview.postMessage({
        type: "hideTyping",
      });

      // Note: response is now sent via streaming events in queryPerplexityAPI
      // No need to send a separate 'response' event

      // Save to history (save original message, not the one with context)
      this.addUserMessage(message);
      this.addAssistantMessage(response);
    } catch (error) {
      // Hide typing indicator
      this._view?.webview.postMessage({
        type: "hideTyping",
      });

      if (error instanceof Error && error.name === "AbortError") {
        this._view?.webview.postMessage({
          type: "responseStopped",
        });
      } else {
        this._view?.webview.postMessage({
          type: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    } finally {
      this._abortController = undefined;
    }
  }
  private addAssistantMessage(content: string) {
    this.ensureCurrentSession();
    const session = this._sessions.find((s) => s.id === this._currentSessionId);
    if (!session) {
      console.error("No session found for assistant message");
      return;
    }

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: content,
      timestamp: new Date(),
    };
    session.messages.push(assistantMessage);

    this.updateWebview();
    this.saveChatHistory();
  }

  private addUserMessage(content: string) {
    this.ensureCurrentSession();
    let session = this._sessions.find((s) => s.id === this._currentSessionId);

    // If session doesn't exist in array, create it now (first message)
    if (!session) {
      session = {
        id: this._currentSessionId!,
        title: content.length > 50 ? content.substring(0, 50) + "..." : content,
        messages: [],
        createdAt: new Date(),
      };
      this._sessions.unshift(session); // Add to beginning
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: content,
      timestamp: new Date(),
    };
    session.messages.push(userMessage);

    // Update session title if this is the first message
    if (session.messages.length === 1) {
      session.title =
        content.length > 50 ? content.substring(0, 50) + "..." : content;
    }

    this.updateWebview();
    this.saveChatHistory();
  }

  private ensureCurrentSession() {
    if (
      !this._currentSessionId ||
      !this._sessions.find((s) => s.id === this._currentSessionId)
    ) {
      // Create a new session but don't add it to sessions array yet
      // It will be added when the first message is sent
      this._currentSessionId =
        Date.now().toString() + Math.random().toString(36).substr(2, 9);
    }
  }

  public startNewChat() {
    // Just generate a new session ID, but don't create the session until first message
    this._currentSessionId =
      Date.now().toString() + Math.random().toString(36).substr(2, 9);

    this.updateWebview();
    // Don't save chat history here since no session is created yet
  }

  public stopGeneration() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = undefined;

      this._view?.webview.postMessage({
        type: "responseStopped",
      });
    }
  }

  public clearHistory() {
    this._sessions = [];
    this._currentSessionId = undefined;
    this.updateWebview();
    this.saveChatHistory();

    // Don't create a new session after clearing
    // It will be created when the user sends their first message
  }

  public async showChatHistory() {
    if (this._sessions.length === 0) {
      vscode.window.showInformationMessage("No chat history available.");
      return;
    }

    // Create quick pick items from sessions
    const items = this._sessions.map((session) => {
      // Ensure createdAt is a Date object (it might be a string when loaded from storage)
      const createdAt =
        session.createdAt instanceof Date
          ? session.createdAt
          : new Date(session.createdAt);

      return {
        label: session.title,
        description: `${session.messages.length} messages`,
        detail: `Created: ${createdAt.toLocaleDateString()} ${createdAt.toLocaleTimeString()}`,
        session: session,
      };
    });

    // Show quick pick dialog
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a chat session to view",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected) {
      // Switch to the selected session
      this.selectSession(selected.session.id);

      // Show a message with session details
      const messageCount = selected.session.messages.length;
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
    const session = this._sessions.find((s) => s.id === sessionId);
    if (session) {
      this._currentSessionId = sessionId;
      this.updateWebview();
    }
  }

  private updateWebview(showTyping: boolean = false) {
    if (!this._view || !this._view.webview) {
      return;
    }

    try {
      const session = this._sessions.find(
        (s) => s.id === this._currentSessionId
      );

      this._view.webview.postMessage({
        type: "updateChat",
        messages: session?.messages || [],
        sessions: this._sessions.map((s) => ({ id: s.id, title: s.title })),
        currentSessionId: this._currentSessionId,
        showTyping,
      });
    } catch (error) {
      console.error("Error updating webview:", error);
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
    this._currentMode = mode;
  }

  private handleModelChange(model: string) {
    this._currentModel = model;
    // Update the model in workspace configuration
    const config = vscode.workspace.getConfiguration("perplexityAI");
    config.update("model", model, vscode.ConfigurationTarget.Global);
  }

  private async getApiKey(): Promise<string | undefined> {
    return await this._context.secrets.get("perplexity-api-key");
  }

  private async queryPerplexityAPI(
    apiKey: string,
    prompt: string,
    signal?: AbortSignal
  ): Promise<string> {
    // Use the current model selection
    const model = this._currentModel;
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2000,
        temperature: 0.2,
      }),
      signal: signal, // Add abort signal
    });

    if (!response.ok) {
      console.error(response);
      throw new Error(`API request failed: ${response.status}`);
    }

    if (!response.body) {
      console.error("Response body is null");
      return "No response received";
    } else {
      const data: any = await response.json();
      return data.choices[0]?.message?.content || "No response received";
    }
  }

  private async handleStreamingResponse(
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal
  ): Promise<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = "";
    const messageId = Date.now().toString();

    try {
      // Send stream start event
      this._view?.webview.postMessage({
        type: "streamStart",
        messageId: messageId,
      });

      while (true) {
        if (signal?.aborted) {
          throw new Error("Request aborted");
        }

        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.trim() === "") {
            continue;
          }
          if (line.startsWith("data: ")) {
            const data = line.substring(6).trim();

            if (data === "[DONE]") {
              break;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;

              if (content) {
                fullResponse += content;
                // Send chunk to UI
                this._view?.webview.postMessage({
                  type: "streamChunk",
                  messageId: messageId,
                  content: content,
                });
              }
            } catch (e) {
              // Skip invalid JSON
              console.warn("Failed to parse streaming chunk:", data);
            }
          }
        }
      }

      // Send stream end event
      this._view?.webview.postMessage({
        type: "streamEnd",
        messageId: messageId,
      });

      return fullResponse;
    } catch (error) {
      reader.releaseLock();
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  private saveChatHistory() {
    this._context.globalState.update("perplexity-chat-history", this._sessions);
  }

  private loadChatHistory() {
    const saved = this._context.globalState.get<ChatSession[]>(
      "perplexity-chat-history",
      []
    );

    // Convert date strings back to Date objects since they get serialized as strings
    this._sessions = saved.map((session) => ({
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

    if (this._sessions.length > 0) {
      this._currentSessionId = this._sessions[0].id;
    } else {
      // Don't create an initial session automatically
      // It will be created when the user sends their first message
      this._currentSessionId = undefined;
    }
  }

  private attachedContext: any[] = [];

  private async handleAutoDetectContext() {
    try {
      // Only auto-detect if context is empty (first time)
      if (this.attachedContext.length > 0) {
        return;
      }

      // Auto-add current file if one is open
      const currentFile = await this.getCurrentFileContext();
      if (currentFile) {
        this.attachedContext.push(currentFile);
      }

      // Auto-add selection if any
      const selection = await this.getSelectionContext();
      if (selection) {
        this.attachedContext.push(selection);
      }

      // Update the webview with detected context
      this._view?.webview.postMessage({
        type: "contextAttached",
        context: this.attachedContext,
      });
    } catch (error) {
      console.error("Error auto-detecting context:", error);
    }
  }

  private async handleRequestAdditionalContext() {
    try {
      // Create VS Code command palette style picker
      const items: vscode.QuickPickItem[] = [];

      // Add open editors section
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

      // Add files & folders section
      items.push({
        label: "Files & Folders...",
        kind: vscode.QuickPickItemKind.Separator,
      });

      items.push({
        label: "$(folder-opened) Browse Files...",
        description: "Open file browser",
        detail: "Select files from file system",
      });

      // Add workspace files (if workspace is open)
      if (
        vscode.workspace.workspaceFolders &&
        vscode.workspace.workspaceFolders.length > 0
      ) {
        try {
          const workspaceFiles = await vscode.workspace.findFiles(
            "**/*.{js,ts,py,java,cpp,c,cs,php,rb,go,rs,html,css,scss,vue,jsx,tsx,json,md,txt}",
            "**/node_modules/**",
            20 // Limit to 20 files for performance
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
        } catch (error) {
          console.warn("Could not load workspace files:", error);
        }
      }

      // Show quick pick
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Search for files and context to add to your request",
        matchOnDescription: true,
        matchOnDetail: true,
        canPickMany: false,
      });

      if (selected) {
        if (selected.label === "$(folder-opened) Browse Files...") {
          // Fall back to file browser
          await this.showFileBrowser();
        } else if (selected.detail && selected.label.includes("$(file)")) {
          // Add selected file to context
          const filePath = selected.detail;
          await this.addFileToContext(filePath);
        }
      }
    } catch (error) {
      console.error("Error showing context picker:", error);
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
        "Code Files": [
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
        "Web Files": ["html", "css", "scss", "less", "vue", "jsx", "tsx"],
        "Config Files": ["json", "yaml", "yml", "xml", "toml", "ini"],
        Documentation: ["md", "txt", "rst"],
        "All Files": ["*"],
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
      // Check if file is already in context
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

        // Get the file icon URI from VS Code
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
          iconUri: iconUri,
        });

        // Update the webview with all attached context
        this._view?.webview.postMessage({
          type: "contextAttached",
          context: this.attachedContext,
        });
      }
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      vscode.window.showErrorMessage(`Failed to read file: ${filePath}`);
    }
  }

  private async getCurrentFileContext() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return null; // Don't show warning, just return null
    }

    const document = editor.document;
    // Get just the filename from the path
    const fullPath = document.fileName;
    const fileName = fullPath.includes("\\")
      ? fullPath.split("\\").pop()
      : fullPath.split("/").pop() || fullPath;

    // Get the file icon URI from VS Code
    const fileUri = vscode.Uri.file(document.fileName);
    const iconUri = await this.getFileIconUri(fileUri);

    return {
      id: Date.now().toString(),
      type: "file",
      name: fileName, // Only file name, not full path
      path: document.fileName,
      content: document.getText(),
      language: document.languageId,
      extension: (fileName || "").split(".").pop() || "",
      iconUri: iconUri,
    };
  }

  private async getSelectionContext() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return null; // Don't show warning, just return null
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
      return null; // Don't show warning, just return null
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
      fileName: fileName, // Only file name, not full path
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

      // Find the Material Icon Theme extension with more thorough search
      const allExtensions = vscode.extensions.all;

      // Try multiple ways to find the extension
      let materialIconExt = allExtensions.find(
        (ext) => ext.id === "pkief.material-icon-theme"
      );

      if (!materialIconExt) {
        // Try alternative search methods
        materialIconExt = allExtensions.find(
          (ext) => ext.packageJSON?.name === "material-icon-theme"
        );
      }

      if (!materialIconExt) {
        materialIconExt = allExtensions.find((ext) =>
          ext.packageJSON?.displayName?.includes("Material Icon Theme")
        );
      }

      if (materialIconExt) {
        // Try to activate the extension if it's not active
        if (!materialIconExt.isActive) {
          await materialIconExt.activate();
        }
      }

      if (!materialIconExt || !this._view) {
        // Return a simple test icon to see if the problem is with icon loading or CSS
        if (this._view) {
          // Create a simple data URI for a test icon
          const testSvg = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="16" height="16" fill="#007ACC"/>
            <text x="8" y="12" text-anchor="middle" fill="white" font-size="10" font-family="Arial">${extension
              .charAt(0)
              .toUpperCase()}</text>
          </svg>`;
          const dataUri = `data:image/svg+xml;base64,${Buffer.from(
            testSvg
          ).toString("base64")}`;
          return dataUri;
        }

        return undefined;
      }

      // Material Icon Theme mapping for common extensions
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

      // Check for specific file names first
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

      // Construct the icon path within the Material Icon Theme extension
      const iconPath = vscode.Uri.joinPath(
        materialIconExt.extensionUri,
        "icons",
        `${iconName}.svg`
      );

      // Check if the icon file exists
      try {
        await vscode.workspace.fs.stat(iconPath);
      } catch (error) {
        console.warn(`Icon file does not exist: ${iconPath.toString()}`);
        // Try fallback to 'file' icon
        const fallbackIconPath = vscode.Uri.joinPath(
          materialIconExt.extensionUri,
          "icons",
          "file.svg"
        );
        try {
          await vscode.workspace.fs.stat(fallbackIconPath);
          const webviewUri = this._view.webview.asWebviewUri(fallbackIconPath);
          return webviewUri.toString();
        } catch (fallbackError) {
          console.warn(
            `Fallback icon also missing: ${fallbackIconPath.toString()}`
          );
          // Use test icon as final fallback
          const testSvg = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="16" height="16" fill="#666"/>
            <text x="8" y="12" text-anchor="middle" fill="white" font-size="8" font-family="Arial">${extension
              .charAt(0)
              .toUpperCase()}</text>
          </svg>`;
          const dataUri = `data:image/svg+xml;base64,${Buffer.from(
            testSvg
          ).toString("base64")}`;
          return dataUri;
        }
      }

      // Convert to webview URI
      const webviewUri = this._view.webview.asWebviewUri(iconPath);
      return webviewUri.toString();
    } catch (error) {
      console.warn("Failed to get file icon:", error);

      // Final fallback - create a simple colored square with first letter
      if (this._view) {
        const fileName = fileUri.path.split("/").pop() || "";
        const extension = fileName.split(".").pop()?.toLowerCase() || "";
        const testSvg = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="16" height="16" fill="#ff6b6b"/>
          <text x="8" y="12" text-anchor="middle" fill="white" font-size="8" font-family="Arial">${extension
            .charAt(0)
            .toUpperCase()}</text>
        </svg>`;
        const dataUri = `data:image/svg+xml;base64,${Buffer.from(
          testSvg
        ).toString("base64")}`;
        return dataUri;
      }
    }
    return undefined;
  }

  private handleRemoveContext(contextId: string) {
    this.attachedContext = this.attachedContext.filter(
      (ctx) => ctx.id !== contextId
    );
    this._view?.webview.postMessage({
      type: "contextAttached",
      context: this.attachedContext,
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const nonce = getNonce();

    // Get the local path to the webview assets
    const webviewPath = vscode.Uri.joinPath(
      this._extensionUri,
      "src",
      "chat-view"
    );

    // Convert to webview URIs
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(webviewPath, "styles.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(webviewPath, "script.js")
    );

    const htmlPath = vscode.Uri.joinPath(webviewPath, "index.html");

    try {
      // Read the HTML template
      const htmlContent = fs.readFileSync(htmlPath.fsPath, "utf8");

      // Replace placeholders with actual URIs
      return htmlContent
        .replace("{{CSS_URI}}", styleUri.toString())
        .replace("{{JS_URI}}", scriptUri.toString())
        .replace("{{NONCE}}", nonce);
    } catch (error) {
      console.error("Error loading webview files:", error);
      // Fallback to inline content if files don't exist
      return this._getFallbackHtml(webview, nonce);
    }
  }

  private _getFallbackHtml(webview: vscode.Webview, nonce: string) {
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
