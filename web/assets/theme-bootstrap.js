(() => {
  let preference = "system";
  let language = "";
  try {
    preference = localStorage.getItem("hcc2d-theme") || "system";
    language = localStorage.getItem("hcc2d-language") || "";
  } catch {
    // Storage can be unavailable in hardened or embedded browser contexts.
  }
  if (!["system", "light", "dark"].includes(preference)) preference = "system";
  const dark = preference === "dark"
    || (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themePreference = preference;

  const browserLanguage = language || navigator.languages?.[0] || navigator.language || "en";
  const candidate = browserLanguage.toLowerCase();
  const supported = candidate.startsWith("zh")
    ? "zh-hans"
    : (["en", "es", "it", "ja"].includes(candidate.split("-")[0]) ? candidate.split("-")[0] : "en");
  document.documentElement.dataset.language = supported;
  document.documentElement.lang = supported === "zh-hans" ? "zh-Hans" : supported;
})();
