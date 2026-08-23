// investor-gate.js  (ig-v1)
// Serves the password-gate JS for the BD investor-brief page.
// BD strips inline <script>, so the page loads this instead via a tiny stub.
// Change the password by editing PW below, then redeploy.

exports.handler = async function () {
  const PW = "renters2026"; // <-- the access code you share in the email

  // No backslashes, no regex — plain JS. Served as text/javascript.
  const js = [
    "(function(){",
    "  var PW = " + JSON.stringify(PW) + ";",
    "  function unlock(){",
    "    var f = document.getElementById('rc-pw');",
    "    var v = f ? f.value : '';",
    "    if (v && v.toLowerCase() === PW.toLowerCase()){",
    "      var g = document.getElementById('rc-gate'); if (g) g.style.display = 'none';",
    "      var d = document.getElementById('rc-deck'); if (d) d.style.display = 'block';",
    "      window.scrollTo(0,0);",
    "    } else {",
    "      var e = document.getElementById('rc-err');",
    "      if (e) e.textContent = 'That code did not match. Check your email or contact kenny@renters.com.';",
    "    }",
    "  }",
    "  function wire(){",
    "    var b = document.getElementById('rc-go');",
    "    var f = document.getElementById('rc-pw');",
    "    if (b) b.addEventListener('click', unlock);",
    "    if (f) f.addEventListener('keydown', function(ev){ if (ev.key === 'Enter'){ unlock(); } });",
    "  }",
    "  if (document.readyState === 'loading'){",
    "    document.addEventListener('DOMContentLoaded', wire);",
    "  } else { wire(); }",
    "})();"
  ].join("\n");

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: js
  };
};
