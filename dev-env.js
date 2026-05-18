(function () {
  const hmr = document.createElement("script");
  hmr.src = "/systems/faserip/@vite/client";
  hmr.type = "module";
  document.head.prepend(hmr);

  const lib = document.createElement("script");
  lib.src = "/systems/faserip/src/faserip.js";
  lib.type = "module";
  document.head.appendChild(lib);
})();
