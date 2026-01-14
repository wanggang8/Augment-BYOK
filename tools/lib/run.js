"use strict";

const { spawnSync } = require("child_process");

function run(cmd, args, { cwd } = {}) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.error) throw r.error;
  if (typeof r.status === "number" && r.status !== 0) throw new Error(`command failed: ${cmd} ${args.join(" ")}`);
}

module.exports = { run };

