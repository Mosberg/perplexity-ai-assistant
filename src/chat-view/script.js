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
  populateModelSelect(); // Show all models initially
}

function populateModelSelect(validModels = null) {
  const modelSelect = document.getElementById("modelSelect");
  if (!modelSelect) {
    return;
  }

  // Clear existing options
  modelSelect.innerHTML = "";

  availableModels.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.id;

    // Create wrapper div for icon and text
    const wrapper = document.createElement("div");
    wrapper.className = "model-option";
    wrapper.innerHTML = `
            <i class="codicon codicon-${model.icon}"></i>
            <span>${model.name}</span>
        `;

    option.appendChild(wrapper);
    modelSelect.appendChild(option);
  });

  // Set default model
  const defaultModel =
    availableModels.find((m) => m.id === "sonar") || availableModels[0];
  if (defaultModel) {
    modelSelect.value = defaultModel.id;
  }

  // Add change event listener
  modelSelect.addEventListener("change", function (e) {
    const selectedModel = availableModels.find((m) => m.id === e.target.value);
    if (selectedModel) {
      vscode.postMessage({
        type: "modelChange",
        model: selectedModel.id,
      });
    }
  });
}

function getIconUri(webview, extensionUri, iconName) {
  return webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "resources", "icons", iconName)
  );
}

// Event Listeners
function setupEventListeners() {
  // Auto-resize textarea
  messageInput.addEventListener("input", handleInputChange);

  // Send message on Enter (but allow Shift+Enter for new lines)
  messageInput.addEventListener("keydown", handleKeyDown);

  // Send button click
  sendButton.addEventListener("click", sendMessage);

  // Initialize send button state
  updateSendButton();

  // Attach context button (for additional files only)
  const attachBtn = document.getElementById("attachBtn");
  if (attachBtn) {
    attachBtn.addEventListener("click", handleAttachContext);
  }

  // Handle messages from extension
  window.addEventListener("message", handleVSCodeMessage);

  // Auto-detect context when extension loads (only once)
  setTimeout(autoDetectContext, 500);
}

// Input handling
function handleInputChange() {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + "px";

  // Update send button state
  updateSendButton();
}

function handleKeyDown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// Message handling
function sendMessage() {
  if (isGenerating) {
    // Stop the current generation
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

    // Add/remove disabled class for visual styling
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
let streamingMessages = new Map(); // Store streaming message elements by ID

function startStreamingMessage(messageId) {
  // Hide welcome message if visible
  if (welcomeMessage.style.display !== "none") {
    welcomeMessage.style.display = "none";
  }

  // Create the streaming message element
  const messageDiv = document.createElement("div");
  messageDiv.className = "message assistant";
  messageDiv.id = `streaming-${messageId}`;

  const time = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  messageDiv.innerHTML = `
        <div class="message-header">
            <div class="message-avatar assistant-avatar">
                <i class="codicon codicon-robot"></i>
            </div>
            <div class="message-author">Perplexity AI</div>
            <div class="message-time">${time}</div>
            <div class="message-status">
                <i class="codicon codicon-loading codicon-modifier-spin" title="Streaming"></i>
            </div>
        </div>
        <div class="message-content">
            <div class="streaming-content"></div>
            <span class="streaming-cursor">|</span>
        </div>
    `;

  // Insert before typing indicator
  messagesContainer.insertBefore(messageDiv, typingIndicator);

  // Store reference for updates
  streamingMessages.set(messageId, {
    element: messageDiv,
    content: "",
    contentElement: messageDiv.querySelector(".streaming-content"),
  });

  // Scroll to bottom
  messageDiv.scrollIntoView({ behavior: "smooth", block: "end" });
}

function appendToStreamingMessage(messageId, chunk) {
  const streamingMessage = streamingMessages.get(messageId);
  if (!streamingMessage) {
    return;
  }

  // Append the new chunk to content
  streamingMessage.content += chunk;

  // Convert markdown and update display
  streamingMessage.contentElement.innerHTML = formatMessageContent(
    streamingMessage.content
  );

  // Scroll to bottom if user is near bottom
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

  // Remove streaming cursor and status
  const cursor = streamingMessage.element.querySelector(".streaming-cursor");
  const status = streamingMessage.element.querySelector(".message-status");
  if (cursor) {
    cursor.remove();
  }
  if (status) {
    status.remove();
  }

  // Add message actions
  const actionsDiv = document.createElement("div");
  actionsDiv.className = "message-actions";
  actionsDiv.innerHTML = `
        <button class="message-action" onclick="copyMessage(this)" title="Copy message">
            <i class="codicon codicon-copy"></i> Copy
        </button>
        <button class="message-action" onclick="insertAtCursor(this)" title="Insert at cursor">
            <i class="codicon codicon-edit"></i> Insert
        </button>
    `;
  streamingMessage.element
    .querySelector(".message-content")
    .appendChild(actionsDiv);

  // Add to messages array
  const messageObj = {
    role: "assistant",
    content: streamingMessage.content,
    timestamp: Date.now(),
  };
  messages.push(messageObj);

  // Clean up
  streamingMessages.delete(messageId);

  // Remove streaming ID and class
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
        <div class="message-content">
            ${formatMessageContent(content)}
        </div>
        <div class="message-actions">
            <button class="message-action" onclick="copyMessage(this)">
                <i class="codicon codicon-copy"></i>
            </button>
        </div>
    `;

  if (welcomeMessage.style.display !== "none") {
    welcomeMessage.style.display = "none";
  }

  messagesContainer.insertBefore(messageDiv, typingIndicator);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  // Only add to messages array if explicitly requested (for new messages)
  if (addToArray) {
    messages.push({
      role,
      content,
      timestamp: timestamp || new Date().toISOString(),
    });
  }
}

function formatMessageContent(content) {
  // Enhanced markdown formatting
  let formatted = content
    // Code blocks (must come before inline code)
    .replace(
      /```(\w+)?\n?([\s\S]*?)```/g,
      '<pre><code class="language-$1">$2</code></pre>'
    )
    // Inline code
    .replace(/`([^\n`]+)`/g, "<code>$1</code>")
    // Bold text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    // Italic text
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    // Headers
    .replace(/^### (.*$)/gm, "<h3>$1</h3>")
    .replace(/^## (.*$)/gm, "<h2>$1</h2>")
    .replace(/^# (.*$)/gm, "<h1>$1</h1>")
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // Handle lists separately to avoid br tags inside them
  const lines = formatted.split("\n");
  const result = [];
  let inList = false;
  let listItems = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if this is a list item
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
      // Empty line within a list - continue the list
      continue;
    } else {
      // Not a list item and not an empty line in a list
      if (inList) {
        // Close the current list
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

  // Close any remaining list
  if (inList) {
    result.push(`<ul>${listItems.join("")}</ul>`);
  }

  // Post-process to wrap non-formatted content in paragraphs
  return wrapInParagraphs(result.join(""));
}

// Wrap plain text content in paragraph tags while preserving formatted content
function wrapInParagraphs(content) {
  // Split content by block-level elements
  const blockElements =
    /<(ul|ol|li|h[1-6]|pre|div|blockquote)[\s>]|<\/(ul|ol|li|h[1-6]|pre|div|blockquote)>/i;

  if (!blockElements.test(content)) {
    // If no block elements, wrap everything in a paragraph
    return `<p>${content}</p>`;
  }

  // For content with block elements, only wrap standalone text in paragraphs
  return content
    .replace(/^([^<].*?)$/gm, "<p>$1</p>")
    .replace(/<p><\/p>/g, "") // Remove empty paragraphs
    .replace(/<p><br><\/p>/g, "<br>"); // Convert paragraph with just br to br
}

// Get appropriate VS Code icon class for file extension
function getFileIconClass(extension, fileName) {
  // VS Code codicon mapping for common file types
  const iconMap = {
    // Programming languages
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

    // Web files
    html: "codicon codicon-file-code",
    css: "codicon codicon-file-code",
    scss: "codicon codicon-file-code",
    less: "codicon codicon-file-code",
    vue: "codicon codicon-file-code",

    // Data files
    json: "codicon codicon-json",
    xml: "codicon codicon-file-code",
    yaml: "codicon codicon-file-code",
    yml: "codicon codicon-file-code",
    toml: "codicon codicon-file-code",
    ini: "codicon codicon-file-code",

    // Documentation
    md: "codicon codicon-markdown",
    txt: "codicon codicon-file-text",
    rst: "codicon codicon-file-text",

    // Images
    png: "codicon codicon-file-media",
    jpg: "codicon codicon-file-media",
    jpeg: "codicon codicon-file-media",
    gif: "codicon codicon-file-media",
    svg: "codicon codicon-file-media",
    ico: "codicon codicon-file-media",

    // Archives
    zip: "codicon codicon-file-zip",
    tar: "codicon codicon-file-zip",
    gz: "codicon codicon-file-zip",
    rar: "codicon codicon-file-zip",

    // Special files
    pdf: "codicon codicon-file-pdf",
  };

  // Check for specific filenames
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

  // Trigger input change to update send button state and auto-resize
  handleInputChange();

  // Hide welcome message since user has interacted
  const welcomeMessage = document.getElementById("welcomeMessage");
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

// Context attachment functionality
function autoDetectContext() {
  // Request automatic context detection from extension
  vscode.postMessage({ type: "autoDetectContext" });
}

function handleAttachContext() {
  // Only for adding additional files
  vscode.postMessage({ type: "requestAdditionalContext" });
}

function handleAddSelection() {
  vscode.postMessage({ type: "addSelection" });
}

function attachContext(context) {
  const attachedContext = document.querySelector(".chat-attached-context");

  // Clear previous context
  attachedContext.innerHTML = "";

  if (context && context.length > 0) {
    // Show the container as flex to display items inline
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
  item.title = context.path || context.name; // Show full path on hover

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
      // Use VS Code file icons based on extension and filename
      const extension = context.extension || "";
      const fileName = context.name || "";

      if (context.iconUri) {
        // Use the actual VS Code file icon from the theme via ::before pseudo-element
        icon.className = "context-icon file-icon-themed";
        icon.style.setProperty("--icon-uri", `url('${context.iconUri}')`);
        // TEMP: Also try setting background directly for debugging
        icon.style.backgroundImage = `url('${context.iconUri}')`;
        icon.style.backgroundSize = "16px 16px";
        icon.style.backgroundRepeat = "no-repeat";
        icon.style.backgroundPosition = "center";
        // Also add a test background color to see if the element is there
        icon.style.backgroundColor = "#ff000020"; // Light red background for debugging
      } else {
        // Fallback to codicon classes
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

  // Hide container if no more items
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
    sessions,
    currentSessionId,
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

// Update chat messages from session data
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
      addMessage(message.role, message.content, message.timestamp, false); // false to prevent duplicating to messages array
    });
  }
}

// Options Row functionality
function setupOptionsRow() {
  // Mode dropdown handling
  const modeDropdownToggle = document.getElementById("modeDropdownToggle");
  const modeDropdownMenu = document.getElementById("modeDropdownMenu");
  const modeLabel = document.getElementById("modeLabel");
  const modeSelect = document.getElementById("modeSelect");

  // Toggle mode dropdown
  modeDropdownToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = modeDropdownMenu.classList.contains("show");

    // Close all dropdowns first
    closeAllDropdowns();

    if (!isOpen) {
      modeDropdownMenu.classList.add("show");
      modeDropdownToggle.setAttribute("aria-expanded", "true");
      updateSelectedItem(modeDropdownMenu, modeSelect.value);

      // Position dropdown based on available space
      positionDropdown(modeDropdownToggle, modeDropdownMenu);
    }
  });

  // Handle mode selection
  modeDropdownMenu.addEventListener("click", (e) => {
    const item = e.target.closest(".dropdown-item");
    if (item) {
      const value = item.dataset.value;
      const text = item.querySelector(".dropdown-text").textContent;

      modeSelect.value = value;
      modeLabel.textContent = text;
      modeDropdownMenu.classList.remove("show");
      modeDropdownToggle.setAttribute("aria-expanded", "false");

      updateSelectedItem(modeDropdownMenu, value);
      handleModeChange(value);
    }
  });

  // Model dropdown handling
  const modelDropdownToggle = document.getElementById("modelDropdownToggle");
  const modelDropdownMenu = document.getElementById("modelDropdownMenu");
  const modelLabel = document.getElementById("modelLabel");
  const modelSelect = document.getElementById("modelSelect");

  // Toggle model dropdown
  modelDropdownToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = modelDropdownMenu.classList.contains("show");

    // Close all dropdowns first
    closeAllDropdowns();

    if (!isOpen) {
      modelDropdownMenu.classList.add("show");
      modelDropdownToggle.setAttribute("aria-expanded", "true");
      updateSelectedItem(modelDropdownMenu, modelSelect.value);

      // Position dropdown based on available space
      positionDropdown(modelDropdownToggle, modelDropdownMenu);
    }
  });

  // Handle model selection
  modelDropdownMenu.addEventListener("click", (e) => {
    const item = e.target.closest(".dropdown-item");
    if (item) {
      const value = item.dataset.value;
      const text = item.querySelector(".dropdown-text").textContent;

      modelSelect.value = value;
      modelLabel.textContent = text;
      modelDropdownMenu.classList.remove("show");
      modelDropdownToggle.setAttribute("aria-expanded", "false");

      updateSelectedItem(modelDropdownMenu, value);
      handleModelChange(value);
    }
  });

  // Close dropdowns when clicking outside
  document.addEventListener("click", () => {
    closeAllDropdowns();
  });

  // Initialize selected states
  updateSelectedItem(modeDropdownMenu, modeSelect.value);
  updateSelectedItem(modelDropdownMenu, modelSelect.value);
}

function closeAllDropdowns() {
  const dropdowns = document.querySelectorAll(".dropdown-menu");
  const toggles = document.querySelectorAll("[aria-expanded]");

  dropdowns.forEach((dropdown) => {
    dropdown.classList.remove("show");
    dropdown.classList.remove("dropdown-up"); // Reset positioning
  });

  toggles.forEach((toggle) => {
    toggle.setAttribute("aria-expanded", "false");
  });
}

function updateSelectedItem(menu, selectedValue) {
  const items = menu.querySelectorAll(".dropdown-item");
  items.forEach((item) => {
    item.classList.toggle("selected", item.dataset.value === selectedValue);
  });
}

function handleModeChange(mode) {
  // Update placeholder text based on mode
  const messageInput = document.getElementById("messageInput");
  switch (mode) {
    case "ask":
      messageInput.placeholder = "Ask Perplexity AI...";
      break;
    case "agent":
      messageInput.placeholder =
        "Describe the task you want the AI agent to complete...";
      break;
    case "edit":
      messageInput.placeholder =
        "Describe what you want to edit or refactor...";
      break;
  }

  // Send mode change to extension
  vscode.postMessage({
    type: "modeChange",
    mode: mode,
  });
}

function handleModelChange(model) {
  // Send model change to extension
  vscode.postMessage({
    type: "modelChange",
    model: model,
  });
}

// Position dropdown based on available space
function positionDropdown(toggle, menu) {
  // Reset positioning classes
  menu.classList.remove("dropdown-up");

  // Get the bounding rectangles
  const toggleRect = toggle.getBoundingClientRect();
  const menuHeight = menu.offsetHeight || 150; // Fallback height if not visible yet
  const viewportHeight = window.innerHeight;

  // Calculate space below and above the toggle
  const spaceBelow = viewportHeight - toggleRect.bottom;
  const spaceAbove = toggleRect.top;

  // If there's not enough space below but there's more space above, position upward
  if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
    menu.classList.add("dropdown-up");
  }
}

// Initialize when DOM is loaded
init();
