# Copilot Instructions: Perplexity AI Assistant VS Code Extension

## Overview

This project is a VS Code extension that embeds Perplexity AI chat and code assistance into the editor. It features:

- AI-powered chat (multi-model)
- Secure API key management
- Customizable model/settings UI
- All UI is delivered via VS Code Webview API

## Architecture & Data Flow

- **Entry Point:** `src/extension.ts` registers commands and webview providers for chat and settings.
- **Chat Logic:** `src/chatProvider.ts` manages chat sessions, message history, and communication with the webview. Uses `PerplexityCustomChatProvider.viewType` for registration.
- **Settings:** `src/settingsProvider.ts` provides a settings webview, handles API key storage (via VS Code secrets), and model configuration.
- **Webview UI:** All user-facing UI (HTML, JS, CSS) is in `src/chat-view/`. Communication between webview and backend uses `onDidReceiveMessage`/`postMessage`.
- **Persistence:**
  - Chat sessions/messages: In-memory, persisted via VS Code extension context storage
  - API keys: Stored securely with VS Code secret storage (never in plain text)
  - Model/settings: Saved in VS Code global configuration

## Developer Workflows

- **Build:** No custom build step; TypeScript is compiled by VS Code. If needed, run `tsc`.
- **Debug:** Use VS Code's extension development host (F5) to launch/debug.
- **Install:** Standard VS Code extension install. See `README.md` for user steps.
- **Testing:** No automated tests as of this version.

## Project-Specific Conventions

- All user-facing strings and UI logic are in `src/chat-view/` (not in backend TypeScript).
- Model IDs and API endpoints are hardcoded in both frontend (`script.js`) and backend (`chatProvider.ts`). Update both when adding models.
- Use `vscode.window.showInformationMessage` for user notifications.
- API key is required for chat; prompt user via settings if missing.
- No external build tools or frameworks are used.

## Integration & Extension

- Integrates with Perplexity AI API (user must provide their own API key).
- Uses VS Code's secret storage and configuration APIs for all sensitive or persistent data.
- To add a new chat model:
  1.  Add to `availableModels` in `src/chat-view/script.js` (UI dropdown)
  2.  Update model handling logic in `src/chatProvider.ts`
- To persist new settings: Update both the settings webview and backend config logic.

## Examples

- **Add a new model:**
  - `src/chat-view/script.js`: Add to `availableModels` array
  - `src/chatProvider.ts`: Add model handling logic
- **Add a new user-facing setting:**
  - Update settings UI in `src/chat-view/`
  - Update config logic in `settingsProvider.ts`

## References

- See `README.md` for user-facing instructions and support links.
- Key files: `src/extension.ts`, `src/chatProvider.ts`, `src/settingsProvider.ts`, `src/chat-view/`
