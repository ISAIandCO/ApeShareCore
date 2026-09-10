import { renderMarkdown } from "./markdown.js";
export function renderChatMessages(container, messages, { messageClass = "ai-message", attachmentsClass = "ai-attachments", emptyText = "Диалог пока пуст." } = {}) {
  const document = container.ownerDocument;
  container.replaceChildren();
  for (const message of messages) {
    const article = document.createElement("article"); article.className = `${messageClass} ${message.role}`;
    const heading = document.createElement("strong"); heading.textContent = message.role === "user" ? "Аналитик" : "SEC AI Assistant";
    const content = document.createElement("div"); content.className = "markdown-body";
    renderMarkdown(content, message.content); article.append(heading, content);
    if (message.attachments?.length) {
      const attachments = document.createElement("div"); attachments.className = attachmentsClass;
      for (const item of message.attachments) {
        const chip = document.createElement("span"); chip.textContent = `${item.type}: ${item.label}`; attachments.append(chip);
      }
      article.append(attachments);
    }
    container.append(article);
  }
  if (!container.children.length) container.textContent = emptyText;
}
