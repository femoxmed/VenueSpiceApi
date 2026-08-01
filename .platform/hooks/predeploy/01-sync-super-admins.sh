#!/bin/bash
set -euo pipefail

echo "[predeploy] Running Venue Spice deployment sync tasks"

if [ -x /opt/elasticbeanstalk/bin/get-config ]; then
  echo "[predeploy] Loading Elastic Beanstalk environment variables"
  if command -v python3 >/dev/null 2>&1; then
    eval "$(/opt/elasticbeanstalk/bin/get-config environment | python3 -c 'import json, shlex, sys
env = json.load(sys.stdin)
for key, value in env.items():
    if key.replace("_", "").isalnum() and not key[0].isdigit():
        print(f"export {key}={shlex.quote(str(value))}")')"
  else
    eval "$(/opt/elasticbeanstalk/bin/get-config environment | node -e 'let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  const env = JSON.parse(input);
  const quote = (value) => "'"'"'" + String(value).replace(/'"'"'/g, "'"'"'\\'"'"''"'"'") + "'"'"'";
  for (const [key, value] of Object.entries(env)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      console.log(`export ${key}=${quote(value)}`);
    }
  }
});')"
  fi
fi

APP_DIR="/var/app/staging"
if [ ! -d "$APP_DIR" ]; then
  APP_DIR="/var/app/current"
fi

cd "$APP_DIR"
echo "[predeploy] App directory: $APP_DIR"
echo "[predeploy] Database target: ${DB_HOST:-missing}/${DB_NAME:-missing} as ${DB_USERNAME:-missing}"

if [ "${SEED_VENDOR_CATEGORIES_ON_DEPLOY:-true}" = "false" ]; then
  echo "[predeploy] Skipping vendor category seed because SEED_VENDOR_CATEGORIES_ON_DEPLOY=false"
else
  echo "[predeploy] Seeding vendor categories"
  npm run seed:vendor-categories
  echo "[predeploy] Vendor category seed finished"
fi

if [ "${SYNC_SUPER_ADMINS_ON_DEPLOY:-true}" = "false" ]; then
  echo "[predeploy] Skipping super admin sync because SYNC_SUPER_ADMINS_ON_DEPLOY=false"
  exit 0
fi

npm run sync:super-admins

echo "[predeploy] Super admin sync finished"
