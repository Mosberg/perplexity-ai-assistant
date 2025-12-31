# Copilot Instructions for Perplexity AI Assistant

## Project Overview
- This is a VS Code extension integrating Perplexity AI chat and code assistance directly into the editor.
- Main features: AI-powered chat, model selection, API key management, and customizable settings.
- The extension is structured around VS Code's Webview API, with chat and settings as separate providers.

## Key Components
- `src/extension.ts`: Entry point. Registers commands and webview providers for chat and settings.
- `src/chatProvider.ts`: Implements the chat view, session management, and message handling. Defines the main `PerplexityCustomChatProvider` class.
- `src/settingsProvider.ts`: Handles the settings webview, API key storage (using VS Code secrets), and model configuration.
- `src/chat-view/`: Contains the webview UI (HTML, JS, CSS) for the chat interface.

## Data Flow & Patterns
- Chat messages and sessions are managed in-memory and persisted via VS Code's extension context storage.
- Communication between the webview and extension backend uses `onDidReceiveMessage` and `postMessage`.
- API keys are stored securely using VS Code's secret storage, never in plain text files.
- Model selection and settings are updated via the settings webview and persisted in VS Code's global configuration.

## Developer Workflows
- **Build:** No explicit build step for TypeScript; relies on VS Code's built-in compilation. If needed, run `tsc`.
- **Debug:** Use VS Code's extension development host (F5) to launch and debug.
- **Test:** No automated tests present as of this version.
- **Install:** Standard VS Code extension install process. See `README.md` for user steps.

## Project Conventions
- All user-facing strings and UI logic are in `src/chat-view/`.
- Use the `PerplexityCustomChatProvider.viewType` constant for registering the chat view.
- API endpoints and model IDs are hardcoded; update in both backend and frontend if adding new models.
- Use VS Code's `vscode.window.showInformationMessage` for user notifications.

## Integration Points
- Relies on Perplexity AI's API (requires user API key).
- Uses VS Code's secret storage and configuration APIs for settings.
- No external build tools or frameworks required.

## Examples
- To add a new chat model: update `availableModels` in `src/chat-view/script.js` and model handling in `chatProvider.ts`.
- To persist new settings: update both the settings webview and the extension's configuration logic.

## References
- See `README.md` for user-facing instructions and support links.
- Key files: `src/extension.ts`, `src/chatProvider.ts`, `src/settingsProvider.ts`, `src/chat-view/`.
