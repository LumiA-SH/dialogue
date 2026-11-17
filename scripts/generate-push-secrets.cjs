// Run locally. Never commit or paste the output into a chat or frontend .env file.
const { createECDH, randomBytes } = require('crypto');
const pair = createECDH('prime256v1');
pair.generateKeys();
console.log(JSON.stringify({
    VAPID_PUBLIC_KEY: pair.getPublicKey().toString('base64url'),
    VAPID_PRIVATE_KEY: pair.getPrivateKey().toString('base64url'),
    VAPID_SUBJECT: 'https://lumia-sh.github.io/pbp_1.0/',
    PBP_PUSH_HOOK_SECRET: randomBytes(32).toString('base64url')
}, null, 2));
