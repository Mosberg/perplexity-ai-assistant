// Get VS Code API
const vscode = acquireVsCodeApi();

// DOM Elements
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendBtn");
const messagesContainer = document.getElementById("messagesContainer");
const welcomeMessage = document.getElementById("welcomeMessage");
const typingIndicator = document.getElementById("typingIndicator");

// State
let messages = [];
let isTyping = false;
let isGenerating = false;

// Model Configuration
const availableModels = [
  { id: "sonar", name: "Sonar", icon: "waves" },
  { id: "sonar-pro", name: "Sonar Pro", icon: "pulse" },
  { id: "sonar-reasoning", name: "Sonar Reasoning", icon: "lightbulb" },
  {
    id: "sonar-reasoning-pro",
    name: "Sonar Reasoning Pro",
    icon: "lightbulb-sparkle",
  },
];

// Initialize
function init() {
  setupEventListeners();
  populateModelSelect();
}

function populateModelSelect() {
  const modelSelect = document.getElementById("modelSelect");
  if (!modelSelect) {
    return;
  }
  modelSelect.innerHTML = "";
  availableModels.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name;
    modelSelect.appendChild(option);
  });
  const defaultModel =
    availableModels.find((m) => m.id === "sonar") || availableModels[0];
  if (defaultModel) {
    modelSelect.value = defaultModel.id;
  }
  modelSelect.addEventListener("change", (e) => {
    const selectedModel = availableModels.find((m) => m.id === e.target.value);
    if (selectedModel) {
      vscode.postMessage({ type: "modelChange", model: selectedModel.id });
    }
  });
}

// Event Listeners
function setupEventListeners() {
  messageInput.addEventListener("input", handleInputChange);
  messageInput.addEventListener("keydown", handleKeyDown);
  sendButton.addEventListener("click", sendMessage);
  updateSendButton();
  const attachBtn = document.getElementById("attachBtn");
  if (attachBtn) {
    attachBtn.addEventListener("click", handleAttachContext);
  }
  window.addEventListener("message", handleVSCodeMessage);
  setTimeout(autoDetectContext, 500);
}

function handleInputChange() {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + "px";
  updateSendButton();
}

function handleKeyDown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function sendMessage() {
  if (isGenerating) {
    stopGeneration();
    return;
  }
  const message = messageInput.value.trim();
  if (!message || isTyping) {
    return;
  }
  addMessage("user", message);
  messageInput.value = "";
  messageInput.style.height = "auto";
  setGeneratingState(true);
  showTypingIndicator(true);
  vscode.postMessage({ type: "sendMessage", value: message });
}

function stopGeneration() {
  vscode.postMessage({ type: "stopGeneration" });
  setGeneratingState(false);
  showTypingIndicator(false);
}

function setGeneratingState(generating) {
  isGenerating = generating;
  updateSendButton();
}

function updateSendButton() {
  const actionContainer = sendButton.closest(".action-send");
  if (isGenerating) {
    sendButton.innerHTML =
      '<i class="codicon codicon-primitive-square stop-icon"></i>';
    sendButton.title = "Stop generation";
    sendButton.disabled = false;
    sendButton.classList.remove("disabled");
    if (actionContainer) {
      actionContainer.classList.remove("disabled");
    }
  } else {
    sendButton.innerHTML = '<i class="codicon codicon-send send-icon"></i>';
    sendButton.title = "Send message";
    const hasText = messageInput.value.trim();
    sendButton.disabled = !hasText;
    if (hasText) {
      sendButton.classList.remove("disabled");
      if (actionContainer) {
        actionContainer.classList.remove("disabled");
      }
    } else {
      sendButton.classList.add("disabled");
      if (actionContainer) {
        actionContainer.classList.add("disabled");
      }
    }
  }
}

// Streaming message handling
const streamingMessages = new Map();

function startStreamingMessage(messageId) {
  if (welcomeMessage.style.display !== "none") {
    welcomeMessage.style.display = "none";
  }
  const messageDiv = document.createElement("div");
  messageDiv.className = "message assistant";
  messageDiv.id = `streaming-${messageId}`;
  const time = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  messageDiv.innerHTML = `
    <div class="message-header">
      <div class="message-avatar assistant-avatar"><i class="codicon codicon-robot"></i></div>
      <div class="message-author">Perplexity AI</div>
      <div class="message-time">${time}</div>
      <div class="message-status"><i class="codicon codicon-loading codicon-modifier-spin" title="Streaming"></i></div>
    </div>
    <div class="message-content">
      <div class="streaming-content"></div>
      <span class="streaming-cursor">|</span>
    </div>
  `;
  messagesContainer.insertBefore(messageDiv, typingIndicator);
  streamingMessages.set(messageId, {
    element: messageDiv,
    content: "",
    contentElement: messageDiv.querySelector(".streaming-content"),
  });
  messageDiv.scrollIntoView({ behavior: "smooth", block: "end" });
}

function appendToStreamingMessage(messageId, chunk) {
  const streamingMessage = streamingMessages.get(messageId);
  if (!streamingMessage) {
    return;
  }
  streamingMessage.content += chunk;
  streamingMessage.contentElement.innerHTML = formatMessageContent(
    streamingMessage.content
  );
  const container = messagesContainer;
  const isNearBottom =
    container.scrollTop + container.clientHeight >= container.scrollHeight - 50;
  if (isNearBottom) {
    streamingMessage.element.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }
}

function finishStreamingMessage(messageId) {
  const streamingMessage = streamingMessages.get(messageId);
  if (!streamingMessage) {
    return;
  }
  const cursor = streamingMessage.element.querySelector(".streaming-cursor");
  const status = streamingMessage.element.querySelector(".message-status");
  if (cursor) {
    cursor.remove();
  }
  if (status) {
    status.remove();
  }
  const actionsDiv = document.createElement("div");
  actionsDiv.className = "message-actions";
  actionsDiv.innerHTML = `
    <button class="message-action" title="Copy message">
      <i class="codicon codicon-copy"></i> Copy
    </button>
    <button class="message-action" title="Insert at cursor">
      <i class="codicon codicon-edit"></i> Insert
    </button>
  `;
  actionsDiv.querySelectorAll(".message-action")[0].onclick = (e) =>
    copyMessage(e.currentTarget);
  actionsDiv.querySelectorAll(".message-action")[1].onclick = (e) =>
    insertAtCursor(e.currentTarget);
  streamingMessage.element
    .querySelector(".message-content")
    .appendChild(actionsDiv);
  messages.push({
    role: "assistant",
    content: streamingMessage.content,
    timestamp: Date.now(),
  });
  streamingMessages.delete(messageId);
  streamingMessage.element.id = "";
  streamingMessage.element.classList.remove("streaming");
}

function addMessage(role, content, timestamp = null, addToArray = true) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${role}`;
  const time = timestamp
    ? new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  messageDiv.innerHTML = `
    <div class="message-header">
      <div class="message-avatar ${role === "user" ? "user-avatar" : "assistant-avatar"}">
        ${role === "user" ? '<i class="codicon codicon-account"></i>' : '<i class="codicon codicon-copilot"></i>'}
      </div>
      <div class="message-author">${role === "user" ? "You" : "Perplexity AI"}</div>
      <div class="message-time">${time}</div>
    </div>
    <div class="message-content">${formatMessageContent(content)}</div>
    <div class="message-actions">
      <button class="message-action" title="Copy message">
        <i class="codicon codicon-copy"></i>
      </button>
    </div>
  `;
  messageDiv.querySelector(".message-action").onclick = (e) =>
    copyMessage(e.currentTarget);
  if (welcomeMessage.style.display !== "none") {
    welcomeMessage.style.display = "none";
  }
  messagesContainer.insertBefore(messageDiv, typingIndicator);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  if (addToArray) {
    messages.push({
      role,
      content,
      timestamp: timestamp || new Date().toISOString(),
    });
  }
}

function formatMessageContent(content) {
  let formatted = content
    .replace(
      /```(\w+)?\n?([\s\S]*?)```/g,
      '<pre><code class="language-$1">$2</code></pre>'
    )
    .replace(/`([^\n`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/^### (.*$)/gm, "<h3>$1</h3>")
    .replace(/^## (.*$)/gm, "<h2>$1</h2>")
    .replace(/^# (.*$)/gm, "<h1>$1</h1>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  const lines = formatted.split("\n");
  const result = [];
  let inList = false;
  let listItems = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.match(/^[\s]*-[\s]+(.*)/) || line.match(/^[\s]*\d+\.[\s]+(.*)/)) {
      const isUnordered = line.match(/^[\s]*-[\s]+(.*)/);
      const content = isUnordered
        ? line.replace(/^[\s]*-[\s]+(.*)/, "$1")
        : line.replace(/^[\s]*\d+\.[\s]+(.*)/, "$1");
      if (!inList) {
        inList = true;
        listItems = [];
      }
      listItems.push(`<li>${content}</li>`);
    } else if (line === "" && inList) {
      continue;
    } else {
      if (inList) {
        result.push(`<ul>${listItems.join("")}</ul>`);
        inList = false;
        listItems = [];
      }
      if (line.length > 0) {
        result.push(line);
      } else {
        result.push("<br>");
      }
    }
  }
  if (inList) {
    result.push(`<ul>${listItems.join("")}</ul>`);
  }
  return wrapInParagraphs(result.join(""));
}

function wrapInParagraphs(content) {
  const blockElements =
    /<(ul|ol|li|h[1-6]|pre|div|blockquote)[\s>]|<\/(ul|ol|li|h[1-6]|pre|div|blockquote)>/i;
  if (!blockElements.test(content)) {
    return `<p>${content}</p>`;
  }
  return content
    .replace(/^([^<].*?)$/gm, "<p>$1</p>")
    .replace(/<p><\/p>/g, "")
    .replace(/<p><br><\/p>/g, "<br>");
}

function getFileIconClass(extension, fileName) {
  const iconMap = {
    js: "codicon codicon-file-code",
    ts: "codicon codicon-file-code",
    jsx: "codicon codicon-file-code",
    tsx: "codicon codicon-file-code",
    py: "codicon codicon-file-code",
    java: "codicon codicon-file-code",
    cpp: "codicon codicon-file-code",
    c: "codicon codicon-file-code",
    cs: "codicon codicon-file-code",
    php: "codicon codicon-file-code",
    rb: "codicon codicon-file-code",
    go: "codicon codicon-file-code",
    rs: "codicon codicon-file-code",
    html: "codicon codicon-file-code",
    css: "codicon codicon-file-code",
    scss: "codicon codicon-file-code",
    less: "codicon codicon-file-code",
    vue: "codicon codicon-file-code",
    json: "codicon codicon-json",
    xml: "codicon codicon-file-code",
    yaml: "codicon codicon-file-code",
    yml: "codicon codicon-file-code",
    toml: "codicon codicon-file-code",
    ini: "codicon codicon-file-code",
    md: "codicon codicon-markdown",
    txt: "codicon codicon-file-text",
    rst: "codicon codicon-file-text",
    png: "codicon codicon-file-media",
    jpg: "codicon codicon-file-media",
    jpeg: "codicon codicon-file-media",
    gif: "codicon codicon-file-media",
    svg: "codicon codicon-file-media",
    ico: "codicon codicon-file-media",
    zip: "codicon codicon-file-zip",
    tar: "codicon codicon-file-zip",
    gz: "codicon codicon-file-zip",
    rar: "codicon codicon-file-zip",
    pdf: "codicon codicon-file-pdf",
  };
  const lowerFileName = (fileName || "").toLowerCase();
  if (lowerFileName === "package.json") {
    return "codicon codicon-package";
  }
  if (lowerFileName === "readme.md") {
    return "codicon codicon-book";
  }
  if (lowerFileName.includes("dockerfile")) {
    return "codicon codicon-file-code";
  }
  if (
    lowerFileName.endsWith(".config.js") ||
    lowerFileName.endsWith(".config.ts")
  ) {
    return "codicon codicon-settings-gear";
  }
  const lowerExt = extension.toLowerCase();
  return iconMap[lowerExt] || "codicon codicon-file";
}

function showTypingIndicator(show) {
  isTyping = show;
  typingIndicator.style.display = show ? "block" : "none";
  if (show) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

// Utility functions
function insertSuggestion(text) {
  messageInput.value = text;
  messageInput.focus();
  handleInputChange();
  if (welcomeMessage) {
    welcomeMessage.style.display = "none";
  }
}

function copyMessage(button) {
  const messageContent = button
    .closest(".message")
    .querySelector(".message-content").textContent;
  vscode.postMessage({ type: "copyToClipboard", value: messageContent });
}

function insertAtCursor(button) {
  const messageContent = button
    .closest(".message")
    .querySelector(".message-content").textContent;
  vscode.postMessage({ type: "insertAtCursor", value: messageContent });
}

function autoDetectContext() {
  vscode.postMessage({ type: "autoDetectContext" });
}

function handleAttachContext() {
  vscode.postMessage({ type: "requestAdditionalContext" });
}

function handleAddSelection() {
  vscode.postMessage({ type: "addSelection" });
}

function attachContext(context) {
  const attachedContext = document.querySelector(".chat-attached-context");
  attachedContext.innerHTML = "";
  if (context && context.length > 0) {
    attachedContext.style.display = "flex";
    context.forEach((item) => {
      const contextItem = createContextItem(item);
      attachedContext.appendChild(contextItem);
    });
  } else {
    attachedContext.style.display = "none";
  }
}

function createContextItem(context) {
  const item = document.createElement("div");
  item.className = "context-item";
  item.title = context.path || context.name;
  const icon = document.createElement("span");
  icon.className = "context-icon";
  const label = document.createElement("span");
  label.className = "context-label";
  const removeBtn = document.createElement("button");
  removeBtn.className = "context-remove";
  removeBtn.innerHTML = "×";
  removeBtn.title = "Remove from context";
  removeBtn.onclick = (e) => {
    e.stopPropagation();
    removeContextItem(item, context.id);
  };
  switch (context.type) {
    case "file":
      const extension = context.extension || "";
      const fileName = context.name || "";
      if (context.iconUri) {
        icon.className = "context-icon file-icon-themed";
        icon.style.setProperty("--icon-uri", `url('${context.iconUri}')`);
        icon.style.backgroundImage = `url('${context.iconUri}')`;
        icon.style.backgroundSize = "16px 16px";
        icon.style.backgroundRepeat = "no-repeat";
        icon.style.backgroundPosition = "center";
        icon.style.backgroundColor = "#ff000020";
      } else {
        const iconClass = getFileIconClass(extension, fileName);
        icon.className = `context-icon ${iconClass}`;
      }
      label.textContent = fileName;
      break;
    case "selection":
      icon.className = "context-icon codicon codicon-selection";
      label.textContent = `${context.fileName} (${context.lineCount} lines)`;
      break;
    case "workspace":
      icon.textContent = "📁";
      label.textContent = "Workspace";
      break;
    default:
      icon.textContent = "📎";
      label.textContent = context.name || "Context";
  }
  item.appendChild(icon);
  item.appendChild(label);
  item.appendChild(removeBtn);
  return item;
}

function removeContextItem(element, contextId) {
  element.remove();
  vscode.postMessage({ type: "removeContext", contextId });
  const attachedContext = document.querySelector(".chat-attached-context");
  if (attachedContext.children.length === 0) {
    attachedContext.style.display = "none";
  }
}

// VS Code message handling
function handleVSCodeMessage(event) {
  const {
    type,
    content,
    error,
    context,
    messages: newMessages,
    showTyping,
    messageId,
  } = event.data;
  switch (type) {
    case "response":
      setGeneratingState(false);
      showTypingIndicator(false);
      addMessage("assistant", content);
      break;
    case "streamStart":
      setGeneratingState(true);
      showTypingIndicator(false);
      startStreamingMessage(messageId || "streaming");
      break;
    case "streamChunk":
      appendToStreamingMessage(messageId || "streaming", content);
      break;
    case "streamEnd":
      setGeneratingState(false);
      finishStreamingMessage(messageId || "streaming");
      break;
    case "error":
      setGeneratingState(false);
      showTypingIndicator(false);
      addMessage("assistant", `Error: ${error}`);
      break;
    case "showTyping":
      setGeneratingState(true);
      showTypingIndicator(true);
      break;
    case "hideTyping":
      setGeneratingState(false);
      showTypingIndicator(false);
      break;
    case "responseStopped":
      setGeneratingState(false);
      showTypingIndicator(false);
      addMessage("assistant", "[Response stopped by user]", null, false);
      break;
    case "clearMessages":
      messages = [];
      messagesContainer.innerHTML = "";
      messagesContainer.appendChild(welcomeMessage);
      messagesContainer.appendChild(typingIndicator);
      welcomeMessage.style.display = "block";
      setGeneratingState(false);
      break;
    case "updateChat":
      updateChatMessages(newMessages || []);
      if (showTyping) {
        showTypingIndicator(true);
      }
      break;
    case "contextAttached":
      attachContext(context);
      break;
  }
}

function updateChatMessages(newMessages) {
  messages = newMessages;
  messagesContainer.innerHTML = "";
  messagesContainer.appendChild(welcomeMessage);
  messagesContainer.appendChild(typingIndicator);
  if (messages.length === 0) {
    welcomeMessage.style.display = "block";
  } else {
    welcomeMessage.style.display = "none";
    messages.forEach((message) => {
      addMessage(message.role, message.content, message.timestamp, false);
    });
  }
}

// Initialize when DOM is loaded
init();
