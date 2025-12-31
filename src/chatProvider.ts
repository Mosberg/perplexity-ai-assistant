import * as vscode from "vscode";

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
  private currentMode: "ask" | "code" | "debug" = "ask";
  private currentModel = "sonar";
  private abortController?: AbortController;
  private attachedContext: AttachedContext[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {
    this.loadChatHistory();
    const config = vscode.workspace.getConfiguration("perplexityAI");
    this.currentMode = config.get("currentMode", "ask") as
      | "ask"
      | "code"
      | "debug";
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
          case "modeChange":
            this.handleModeChange(data.mode);
            break;
        }
      } catch (err) {
        console.error("Error handling webview message:", err);
      }
      setTimeout(() => this.updateWebview(), 100);
    });
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
          error: "API key not configured.",
        });
        return;
      }

      this.view?.webview.postMessage({ type: "showTyping" });

      let fullMessage = message;
      if (this.attachedContext.length > 0) {
        const contextStrings = this.attachedContext.map((ctx) =>
          ctx.type === "file"
            ? `File: ${ctx.name} (${ctx.language})\n\`\`\`${ctx.language}\n${ctx.content}\n\`\`\``
            : `Selected code from ${ctx.fileName} (lines ${ctx.startLine}-${ctx.endLine}):\n\`\`\`\n${ctx.content}\n\`\`\``
        );
        fullMessage = `Context:\n${contextStrings.join("\n---\n")}\n\nQuestion: ${message}`;
      }

      let modePrompt = "";
      switch (this.currentMode) {
        case "ask":
          modePrompt = "Answer this question:";
          break;
        case "code":
          modePrompt = "Help me write/improve code. Provide complete examples:";
          break;
        case "debug":
          modePrompt = "Debug this issue. Identify problems and provide fixes:";
          break;
      }

      const response = await this.queryPerplexityAPI(
        apiKey,
        `${modePrompt}\n\n${fullMessage}`,
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
    if (session) {
      session.messages.push({
        role: "assistant",
        content,
        timestamp: new Date(),
      });
      this.updateWebview();
      this.saveChatHistory();
    }
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
    session.messages.push({ role: "user", content, timestamp: new Date() });
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

    const items = this.sessions.map((session) => ({
      label: session.title,
      description: `${session.messages.length} messages`,
      detail: `Created ${session.createdAt.toLocaleDateString()} ${session.createdAt.toLocaleTimeString()}`,
      session,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a chat session to view",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected) {
      this.selectSession(selected.session.id);
    }
  }

  public selectSession(sessionId: string) {
    if (this.sessions.find((s) => s.id === sessionId)) {
      this.currentSessionId = sessionId;
      this.updateWebview();
    }
  }

  private handleModeChange(mode: "ask" | "code" | "debug") {
    this.currentMode = mode;
    this.view?.webview.postMessage({
      type: "modeChanged",
      mode: this.currentMode,
    });
    vscode.workspace
      .getConfiguration("perplexityAI")
      .update("currentMode", mode, vscode.ConfigurationTarget.Global);
  }

  private updateWebview() {
    if (!this.view?.webview) {
      return;
    }

    const session = this.sessions.find((s) => s.id === this.currentSessionId);
    this.view.webview.postMessage({
      type: "updateChat",
      messages: session?.messages || [],
      sessions: this.sessions.map((s) => ({ id: s.id, title: s.title })),
      currentSessionId: this.currentSessionId,
      currentMode: this.currentMode,
    });
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
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content || "No response received";
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

  private getHtmlForWebview(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "src", "chatview", "styles.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "src", "chatview", "script.js")
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <script src="${scriptUri}"></script>
</head>
<body>
  <div id="chat-container">
    <div id="chat-messages"></div>
    <div id="chat-input-container">
      <input type="text" id="message-input" placeholder="Ask anything...">
      <button id="send-button">Send</button>
    </div>
  </div>
</body>
</html>`;
  }
}
