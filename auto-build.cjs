const http = require("http");
const { execSync } = require("child_process");

// Check if dev server is running on port 5173 or 30001
function checkPort(port) {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${port}`, () => {
      resolve(true);
    });
    req.on("error", () => {
      resolve(false);
    });
    req.end();
  });
}

async function main() {
  const port5173 = await checkPort(5173);
  const port30001 = await checkPort(30001);

  if (port5173 || port30001) {
    console.log(
      `Dev server detected on port ${port5173 ? "5173" : "30001"}, skipping build...`
    );
    process.exit(0);
  }

  console.log("No dev server detected, running build...");
  execSync("npm run build", { stdio: "inherit" });
}

main();
