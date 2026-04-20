/**
 * Expo SDK usa __UNSAFE_EXPO_HOME_DIRECTORY (no EXPO_HOME) para state.json / telemetría.
 * En Windows, si el perfil bloquea C:\Users\<user>\.android, adb falla: redirigimos HOMEPATH
 * a una carpeta escribible dentro del repo (.adb-home).
 * @see @expo/config getUserState.js → getExpoHomeDirectory
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const expoHome = path.join(root, ".expo-user");
process.env.__UNSAFE_EXPO_HOME_DIRECTORY = expoHome;

if (process.platform === "win32") {
  const adbHome = path.join(root, ".adb-home");
  fs.mkdirSync(adbHome, { recursive: true });
  const resolved = path.resolve(adbHome);
  const m = /^([A-Za-z]):(\\.*)$/.exec(resolved);
  if (m) {
    process.env.HOMEDRIVE = `${m[1]}:`;
    process.env.HOMEPATH = m[2];
  }

  if (!process.env.ANDROID_HOME) {
    const local = process.env.LOCALAPPDATA;
    if (local) {
      const wingetPt = path.join(
        local,
        "Microsoft",
        "WinGet",
        "Packages",
      );
      try {
        const pkgs = fs.readdirSync(wingetPt);
        const match = pkgs.find((p) =>
          p.startsWith("Google.PlatformTools_"),
        );
        if (match) {
          process.env.ANDROID_HOME = path.join(wingetPt, match);
        }
      } catch {
        /* ignorar */
      }
    }
  }
}

const cli = path.join(root, "node_modules", "expo", "bin", "cli");
const args = process.argv.slice(2);
if (args.length === 0) {
  args.push("start");
}

const result = spawnSync(process.execPath, [cli, ...args], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status !== null ? result.status : 1);
