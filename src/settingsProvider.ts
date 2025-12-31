import * as vscode from "vscode";

export class PerplexitySettingsProvider {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext
  ) {}

  public show() {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "perplexity-settings",
      "Perplexity AI Settings",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.webview.html = this.getHtmlForWebview();

    this.panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "saveApiKey":
          await this.context.secrets.store("perplexity-api-key", message.value);
          vscode.window.showInformationMessage("API Key saved successfully");
          break;
        case "saveSettings":
          await this.saveSettings(message.model, message.maxTokens);
          break;
        case "testConnection":
          await this.testApiConnection();
          break;
        case "loadSettings":
          await this.loadCurrentSettings();
          break;
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.loadCurrentSettings();
  }

  private async loadCurrentSettings() {
    if (!this.panel) {
      return;
    }

    const config = vscode.workspace.getConfiguration("perplexityAI");
    const apiKey = await this.context.secrets.get("perplexity-api-key");

    this.panel.webview.postMessage({
      type: "settingsLoaded",
      settings: {
        model: config.get("model"),
        maxTokens: config.get("maxTokens"),
        hasApiKey: Boolean(apiKey),
      },
    });
  }

  private async saveSettings(model: string, maxTokens: number) {
    const config = vscode.workspace.getConfiguration("perplexityAI");
    await config.update("model", model, vscode.ConfigurationTarget.Global);
    await config.update(
      "maxTokens",
      maxTokens,
      vscode.ConfigurationTarget.Global
    );
    vscode.window.showInformationMessage("Settings saved successfully");
  }

  private async testApiConnection() {
    if (!this.panel) {
      return;
    }

    try {
      const apiKey = await this.context.secrets.get("perplexity-api-key");
      if (!apiKey) {
        this.panel.webview.postMessage({
          type: "connectionResult",
          success: false,
          message: "No API key configured",
        });
        return;
      }

      const response = await fetch(
        "https://api.perplexity.ai/chat/completions",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.1-sonar-small-128k-online",
            messages: [{ role: "user", content: "test" }],
            maxTokens: 1,
          }),
        }
      );

      this.panel.webview.postMessage({
        type: "connectionResult",
        success: response.ok,
        message: response.ok
          ? "Connection successful!"
          : `Connection failed: ${response.status}`,
      });
    } catch (error) {
      this.panel.webview.postMessage({
        type: "connectionResult",
        success: false,
        message: `Connection error: ${error}`,
      });
    }
  }

  private getHtmlForWebview() {
    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Perplexity AI Settings</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                    line-height: 1.6;
                }
                .settings-group {
                    margin-block-end: 30px;
                    padding: 20px;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 8px;
                }
                .settings-group h2 {
                    margin-block-start: 0;
                    color: var(--vscode-textLink-foreground);
                }
                .form-row {
                    margin-block-end: 15px;
                }
                label {
                    display: block;
                    margin-block-end: 5px;
                    font-weight: bold;
                }
                input, select, textarea {
                    inline-size: 100%;
                    padding: 8px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    box-sizing: border-box;
                }
                button {
                    padding: 10px 20px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    margin-inline-end: 10px;
                    margin-block-start: 10px;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .status-message {
                    margin-block-start: 10px;
                    padding: 8px;
                    border-radius: 4px;
                    display: none;
                }
                .success {
                    background-color: var(--vscode-inputValidation-infoBackground);
                    border: 1px solid var(--vscode-inputValidation-infoBorder);
                    color: var(--vscode-inputValidation-infoForeground);
                }
                .error {
                    background-color: var(--vscode-inputValidation-errorBackground);
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                    color: var(--vscode-inputValidation-errorForeground);
                }
                .description {
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                    margin-block-start: 5px;
                }
            </style>
        </head>
        <body>
            <h1>Perplexity AI Settings</h1>
            
            <div class="settings-group">
                <h2>API Configuration</h2>
                <div class="form-row">
                    <label for="apiKey">API Key</label>
                    <input type="password" id="apiKey" placeholder="Enter your Perplexity API key">
                    <div class="description">Get your API key from perplexity.ai/settings</div>
                </div>
                <button onclick="saveApiKey()">Save API Key</button>
                <button onclick="testConnection()">Test Connection</button>
                <div id="connectionStatus" class="status-message"></div>
            </div>

            <div class="settings-group">
                <h2>Model Settings</h2>
                <div class="form-row">
                    <label for="model">Default Model</label>
                    <select id="model">
                        <option value="llama-3.1-sonar-small-128k-online">Sonar</option>
                        <option value="llama-3.1-sonar-large-128k-online">Sonar Pro</option>
                        <option value="llama-3.1-sonar-reasoning-128k-online">Sonar Reasoning</option>
                        <option value="llama-3.1-sonar-reasoning-large-128k-online">Sonar Reasoning Pro</option>
                    </select>
                    <div class="description">Choose the model that best fits your needs and budget</div>
                </div>
                <div class="form-row">
                    <label for="maxTokens">Max Tokens</label>
                    <input type="number" id="maxTokens" min="1" max="4001" step="1">
                    <div class="description">Maximum number of tokens in the response (affects cost)</div>
                </div>
                <button onclick="saveSettings()">Save Settings</button>
                <div id="settingsStatus" class="status-message"></div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();

                function saveApiKey() {
                    const apiKey = document.getElementById('apiKey').value;
                    if (apiKey.trim()) {
                        vscode.postMessage({ type: 'saveApiKey', value: apiKey });
                        showStatus('connectionStatus', 'API Key saved successfully', 'success');
                    }
                }

                function saveSettings() {
                    const model = document.getElementById('model').value;
                    const maxTokens = parseInt(document.getElementById('maxTokens').value, 10);
                    vscode.postMessage({ 
                        type: 'saveSettings', 
                        model: model,
                        maxTokens: maxTokens
                    });
                }

                function testConnection() {
                    showStatus('connectionStatus', 'Testing connection...', 'success');
                    vscode.postMessage({ type: 'testConnection' });
                }

                function showStatus(elementId, message, type) {
                    const element = document.getElementById(elementId);
                    element.textContent = message;
                    element.className = \`status-message \${type}\`;
                    element.style.display = 'block';
                    setTimeout(() => {
                        element.style.display = 'none';
                    }, 3000);
                }

                window.addEventListener('message', event => {
                    const { type, settings, success, message } = event.data;
                    switch (type) {
                        case 'settingsLoaded':
                            document.getElementById('model').value = settings.model || 'llama-3.1-sonar-small-128k-online';
                            document.getElementById('maxTokens').value = settings.maxTokens || 2000;
                            break;
                        case 'connectionResult':
                            showStatus('connectionStatus', message, success ? 'success' : 'error');
                            break;
                    }
                });

                vscode.postMessage({ type: 'loadSettings' });
            </script>
        </body>
        </html>`;
  }
}
