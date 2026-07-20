// alerts-card-js.js — ac-v1-disabled
// Card is temporarily off. The w99 loader still fires and this serves a no-op.
// To re-enable: restore the ac-v1 body. No head code change needed either way.

const JS = 'console.log("[Renters alerts] ac-v1 disabled");';

exports.handler = async () => ({
  statusCode: 200,
  headers: {
    "content-type": "application/javascript; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  },
  body: JS
});
