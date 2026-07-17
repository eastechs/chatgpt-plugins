import { Notification } from "electron";
import { getSetting } from "../settings.js";
import { getMainWindow } from "./windows.js";

// REPLACE: shape this to whatever routing key your app uses.
export interface NotificationTarget {
  projectId: string;
  conversationId: string;
}

// Best-effort markdown → plain text for notification bodies. The OS shells
// render notifications as plain text, so leaving inline syntax in (e.g.
// `**bold**`, `[link](url)`) shows the literal asterisks/brackets to the user.
// This is intentionally regex-only — we don't need a real markdown parser
// for a 3-line preview, just legible output.
export function stripMarkdown(text: string): string {
  return (
    text
      // Fenced code blocks: keep the content, drop the fences + lang tag.
      .replace(/```[\w-]*\n?([\s\S]*?)```/g, "$1")
      // Inline code: `foo` → foo
      .replace(/`([^`]+)`/g, "$1")
      // Images: ![alt](url) → alt   (must run before the link rule)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Links: [text](url) → text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // Bold (** or __)
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      // Italic (single * or _)
      .replace(/(?<![*_])([*_])(?!\1)(.+?)\1(?![*_])/g, "$2")
      // Strikethrough
      .replace(/~~(.+?)~~/g, "$1")
      // ATX headings: leading `# `, `## `, …
      .replace(/^#{1,6}\s+/gm, "")
      // Blockquotes
      .replace(/^>\s?/gm, "")
      // Bulleted list markers
      .replace(/^[ \t]*[-*+]\s+/gm, "")
      // Numbered list markers
      .replace(/^[ \t]*\d+\.\s+/gm, "")
      // Horizontal rules
      .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "")
      // Collapse runs of intra-line whitespace
      .replace(/[ \t]+/g, " ")
      .trim()
  );
}

export function showNotification(
  title: string,
  body: string,
  target?: NotificationTarget,
  iconPath?: string,
): void {
  // REPLACE: drop or rename if your settings module doesn't have this key.
  if (!getSetting("notifications")) return;

  const notification = new Notification({
    title,
    body: stripMarkdown(body),
    icon: iconPath,
  });

  if (target) {
    notification.on("click", () => {
      const win = getMainWindow();
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();
      win.webContents.send("notification-navigate", target);
    });
  }

  notification.show();
}
