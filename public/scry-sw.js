globalThis.addEventListener("notificationclick", (event) => {
  const target = typeof event.notification.data?.url === "string" ? event.notification.data.url : "/notifications";
  event.notification.close();
  event.waitUntil(
    globalThis.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const existing = windows.find((client) => new URL(client.url).pathname === target);
      if (existing) {
        await existing.focus();
        return;
      }
      await globalThis.clients.openWindow(target);
    }),
  );
});
