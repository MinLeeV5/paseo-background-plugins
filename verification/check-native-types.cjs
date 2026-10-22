const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) throw new Error(`Pass ${name}`);
  return path.resolve(process.argv[index + 1]);
}

const dependencies = argument("--deps");
const reactNative = argument("--react-native");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-background-typecheck-"));
const config = {
  compilerOptions: {
    strict: true, noEmit: true, skipLibCheck: true,
    jsx: "react-jsx", module: "ESNext", moduleResolution: "Bundler",
    target: "ES2022", lib: ["ES2022"], types: ["react"],
    typeRoots: [path.join(dependencies, "node_modules/@types")],
    baseUrl: dependencies,
    paths: {
      "react": ["node_modules/@types/react/index.d.ts"],
      "react/*": ["node_modules/@types/react/*"],
      "react-native": [path.join(reactNative, "types/index.d.ts")],
    },
  },
  files: [path.join(__dirname, "GlobalBackgroundLayer.tsx")],
};
const file = path.join(temporary, "tsconfig.json");
fs.writeFileSync(file, JSON.stringify(config));
const result = spawnSync(process.execPath, [path.join(dependencies, "node_modules/typescript/bin/tsc"), "-p", file], { encoding: "utf8" });
const report = {
  reactNativeVersion: JSON.parse(fs.readFileSync(path.join(reactNative, "package.json"))).version,
  typescriptVersion: require(path.join(dependencies, "node_modules/typescript/package.json")).version,
  exitCode: result.status,
  compilerOutput: result.stdout + result.stderr,
  deviceTested: false,
};
fs.mkdirSync(path.join(__dirname, "artifacts"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "artifacts/native-typecheck.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exitCode = result.status ?? 1;
