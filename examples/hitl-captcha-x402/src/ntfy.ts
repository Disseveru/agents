export async function sendNtfyAlert(options: {
  topic: string;
  title: string;
  message: string;
  clickUrl: string;
  tags?: string[];
  priority?: number;
}): Promise<void> {
  const response = await fetch(`https://ntfy.sh/${options.topic}`, {
    method: "POST",
    headers: {
      Title: options.title,
      Tags: (options.tags ?? ["warning", "robot"]).join(","),
      Click: options.clickUrl,
      Priority: String(options.priority ?? 4),
      "Content-Type": "text/plain; charset=utf-8"
    },
    body: options.message
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ntfy notification failed (${response.status}): ${text}`);
  }
}
