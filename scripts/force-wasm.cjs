try {
  Object.defineProperty(process.versions, "webcontainer", {
    value: "codex",
    configurable: true,
  });
} catch {
  // Ignore if the runtime disallows overriding process.versions.
}
