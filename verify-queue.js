/* Renters.com Verification Queue — loaded by bookmarklet */
(function() {

  /* ── Inject styles ── */
  var css = `
    #rq-overlay {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6); z-index: 99999;
      display: flex; align-items: flex-start; justify-content: center;
      padding: 20px; overflow-y: auto;
    }
    #rq-panel {
      background: #fff; border-radius: 12px; width: 100%; max-width: 900px;
      font-family: 'Open Sans', Arial, sans-serif; color: #0d2d4e;
      padding: 24px; position: relative;
    }
    #rq-close {
      position: absolute; top: 16px; right: 16px; background: none;
      border: none; font-size: 22px; cursor: pointer; color: #4a5a6a;
    }
    #rq-title { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
    #rq-sub { font-size: 13px; color: #4a5a6a; margin: 0 0 20px; }
    .rq-card {
      border: 1px solid #e8eceb; border-radius: 10px; padding: 16px;
      margin-bottom: 12px; display: grid;
      grid-template-columns: 180px 1fr auto; gap: 16px; align-items: start;
    }
    .rq-photo { width: 180px; height: 120px; object-fit: cover; border-radius: 8px; border: 1px solid #e8eceb; }
    .rq-photo-missing { width: 180px; height: 120px; background: #f4f7f6; border-radius: 8px; border: 1px dashed #ccc; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #888; text-align: center; padding: 8px; }
    .rq-name { font-size: 15px; font-weight: 700; margin: 0 0 4px; }
    .rq-meta { font-size: 12px; color: #4a5a6a; margin: 0 0 2px; }
    .rq-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-right: 4px; }
    .rq-badge-renter { background: #d4efdf; color: #1e8449; }
    .rq-badge-landlord { background: #d6eaf8; color: #1a5276; }
    .rq-badge-other { background: #f4f7f6; color: #4a5a6a; }
    .rq-actions { display: flex; flex-direction: column; gap: 8px; min-width: 100px; }
    .rq-btn { padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; width: 100%; }
    .rq-approve { background: #3a9e8f; color: #fff; }
    .rq-reject { background: #c0392b; color: #fff; }
    .rq-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .rq-status { font-size: 12px; font-weight: 600; padding: 4px 8px; border-radius: 4px; text-align: center; margin-top: 4px; }
    .rq-status-approved { background: #d4efdf; color: #1e8449; }
    .rq-status-rejected { background: #fadbd8; color: #922b21; }
    .rq-loading { text-align: center; padding: 40px; color: #4a5a6a; }
    .rq-filters { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; flex-wrap: wrap; }
    .rq-filter-btn { padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid #e8eceb; background: #fff; color: #0d2d4e; }
    .rq-filter-btn.active { background: #0d2d4e; color: #fff; border-color: #0d2d4e; }
    #rq-count { font-size: 13px; color: #4a5a6a; margin-left: auto; }
  `;
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ── Create overlay ── */
  var overlay = document.createElement('div');
  overlay.id = 'rq-overlay';
  overlay.innerHTML = `
    <div id="rq-panel">
      <button id="rq-close" title="Close">✕</button>
      <p id="rq-title">Verification Queue</p>
      <p id="rq-sub">Loading submissions...</p>
      <div class="rq-filters" id="rq-filters" style="display:none;">
        <button class="rq-filter-btn active" onclick="rqFilter('all')">All</button>
        <button class="rq-filter-btn" onclick="rqFilter('pending')">Pending</button>
        <button class="rq-filter-btn" onclick="rqFilter('approved')">Approved</button>
        <button class="rq-filter-btn" onclick="rqFilter('rejected')">Rejected</button>
        <span id="rq-count"></span>
      </div>
      <div id="rq-list"><div class="rq-loading">Loading verification submissions...</div></div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('rq-close').onclick = function() {
    overlay.remove();
    styleEl.remove();
  };

  /* ── State ── */
  var allCards = [];
  var currentFilter = 'all';

  window.rqFilter = function(f) {
    currentFilter = f;
    document.querySelectorAll('.rq-filter-btn').forEach(function(b) {
      b.classList.toggle('active', b.textContent.toLowerCase() === f);
    });
    renderCards();
  };

  function renderCards() {
    var list = document.getElementById('rq-list');
    var filtered = allCards.filter(function(c) {
      if (currentFilter === 'all') return true;
      return c.status === currentFilter;
    });
    document.getElementById('rq-count').textContent = filtered.length + ' showing';
    if (filtered.length === 0) {
      list.innerHTML = '<div class="rq-loading">No submissions in this category.</div>';
      return;
    }
    list.innerHTML = filtered.map(function(c, i) {
      var badgeClass = c.memberType === 'Renter' ? 'rq-badge-renter' : c.memberType === 'Landlord' ? 'rq-badge-landlord' : 'rq-badge-other';
      var photoHtml = c.photoUrl
        ? '<img class="rq-photo" src="' + c.photoUrl + '" onerror="this.outerHTML=\'<div class=rq-photo-missing>Photo not found or already deleted</div>\'">'
        : '<div class="rq-photo-missing">No photo submitted</div>';
      var statusHtml = c.status !== 'pending'
        ? '<div class="rq-status rq-status-' + c.status + '">' + (c.status === 'approved' ? '✓ Approved' : '✗ Rejected') + '</div>'
        : '';
      return `
        <div class="rq-card" id="rq-card-${c.inquiryId}">
          <div>${photoHtml}</div>
          <div>
            <p class="rq-name">${c.name}</p>
            <p class="rq-meta"><span class="rq-badge ${badgeClass}">${c.memberType}</span> Member #${c.memberId}</p>
            <p class="rq-meta">📧 ${c.email}</p>
            <p class="rq-meta">📍 ${c.location}</p>
            <p class="rq-meta">📅 Submitted: ${c.submitted}</p>
            <p class="rq-meta">📋 Inquiry #${c.inquiryId}</p>
          </div>
          <div class="rq-actions">
            ${c.status === 'pending' ? `
              <button class="rq-btn rq-approve" onclick="rqApprove('${c.inquiryId}','${c.memberId}','${c.photoPath}')">✓ Approve</button>
              <button class="rq-btn rq-reject" onclick="rqReject('${c.inquiryId}','${c.memberId}','${c.photoPath}')">✗ Reject</button>
            ` : statusHtml}
          </div>
        </div>
      `;
    }).join('');
  }

  /* ── Approve ── */
  window.rqApprove = function(inquiryId, memberId, photoPath) {
    if (!confirm('Approve Member #' + memberId + ' and delete their verification photo?')) return;
    var card = allCards.find(function(c) { return c.inquiryId === inquiryId; });
    var btns = document.querySelectorAll('#rq-card-' + inquiryId + ' .rq-btn');
    btns.forEach(function(b) { b.disabled = true; b.textContent = 'Processing...'; });

    /* Step 1: Set member as verified in BD */
    fetch('https://ww2.managemydirectory.com/admin/go.php?widget=Admin-Module-Members&action=update_member&user_id=' + memberId + '&verified=1&noheader=val', {
      method: 'GET', credentials: 'include'
    }).then(function() {
      /* Step 2: Delete the photo */
      if (photoPath) {
        return fetch('https://ww2.managemydirectory.com/admin/fileaddon/delete', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'file=' + encodeURIComponent(photoPath)
        });
      }
    }).then(function() {
      if (card) card.status = 'approved';
      renderCards();
    }).catch(function(err) {
      alert('Error approving member. Please verify manually in BD admin.\n' + err);
      btns.forEach(function(b) { b.disabled = false; });
    });
  };

  /* ── Reject ── */
  window.rqReject = function(inquiryId, memberId, photoPath) {
    var reason = prompt('Optional: enter a rejection reason to include in the notification email (or leave blank):');
    if (reason === null) return;
    var card = allCards.find(function(c) { return c.inquiryId === inquiryId; });
    var btns = document.querySelectorAll('#rq-card-' + inquiryId + ' .rq-btn');
    btns.forEach(function(b) { b.disabled = true; b.textContent = 'Processing...'; });

    /* Delete the photo */
    var deletePromise = photoPath
      ? fetch('https://ww2.managemydirectory.com/admin/fileaddon/delete', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'file=' + encodeURIComponent(photoPath)
        })
      : Promise.resolve();

    deletePromise.then(function() {
      if (card) card.status = 'rejected';
      renderCards();
    }).catch(function(err) {
      alert('Error processing rejection.\n' + err);
      btns.forEach(function(b) { b.disabled = false; });
    });
  };

  /* ── Parse existing inquiry rows from the page ── */
  function parseInquiriesFromPage() {
    var rows = document.querySelectorAll('tr, .inquiry-row, [data-inquiry-id]');
    var parsed = [];

    /* Try to get data from the visible inquiry list */
    var inquiryBlocks = document.querySelectorAll('.views-row, .inquiry-item, tbody tr');
    
    /* Fallback: parse from the rendered HTML we can see */
    var allText = document.body.innerText;
    var memberLinks = document.querySelectorAll('a[href*="member_id"], a[href*="userid"]');
    
    return parsed;
  }

  /* ── Load inquiries via BD API ── */
  function loadInquiries() {
    fetch('https://ww2.managemydirectory.com/admin/go.php?widget=Admin-Module-Form-Inquiries&noheader=val&action=get_inquiries&form_name=verify_business&limit=100', {
      credentials: 'include'
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      processInquiries(data);
    })
    .catch(function() {
      /* If API fails, parse from current page */
      loadFromCurrentPage();
    });
  }

  function loadFromCurrentPage() {
    /* Parse inquiry data visible on the current page */
    var cards = [];
    
    /* Look for member links like "Member ID #3667 - Name" */
    var memberRefs = document.querySelectorAll('a[href*="user_id"], span, td');
    var inquiryData = [];

    /* Get all inquiry detail sections */
    var detailSections = document.querySelectorAll('.views-field, td, .inquiry-details');
    
    /* Simple approach: find all "View Full Inquiry" buttons and their surrounding data */
    var viewBtns = Array.from(document.querySelectorAll('button, a')).filter(function(el) {
      return el.textContent.trim() === 'View Full Inquiry';
    });

    if (viewBtns.length === 0) {
      document.getElementById('rq-sub').textContent = 'No inquiry data found. Make sure you\'re on the BD form inbox page filtered to verify_business submissions.';
      document.getElementById('rq-list').innerHTML = '<div class="rq-loading">Please navigate to the BD form inbox, filter by "verify_business", and click the bookmarklet again.</div>';
      return;
    }

    /* Parse each inquiry row */
    viewBtns.forEach(function(btn, idx) {
      var row = btn.closest('tr') || btn.closest('.views-row') || btn.parentElement.parentElement;
      if (!row) return;

      var text = row.innerText || '';
      var html = row.innerHTML || '';

      /* Extract inquiry ID */
      var inquiryMatch = text.match(/#(\d+)/);
      var inquiryId = inquiryMatch ? inquiryMatch[1] : 'unknown-' + idx;

      /* Extract member ID */
      var memberMatch = text.match(/Member ID #(\d+)/i) || html.match(/Member ID #(\d+)/i) || html.match(/user_id=(\d+)/i);
      var memberId = memberMatch ? memberMatch[1] : '';

      /* Extract name */
      var nameMatch = text.match(/Member ID #\d+\s*[-–]\s*([^\n\r]+)/i);
      var name = nameMatch ? nameMatch[1].trim() : 'Unknown';

      /* Extract email */
      var emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
      var email = emailMatch ? emailMatch[0] : '';

      /* Extract submitted date */
      var dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
      var submitted = dateMatch ? dateMatch[1] : '';

      /* Extract member type */
      var memberType = 'Unknown';
      if (text.match(/renter/i)) memberType = 'Renter';
      if (text.match(/landlord/i)) memberType = 'Landlord';

      /* Build photo URL from member ID */
      var photoPath = '';
      var photoUrl = '';
      if (memberId) {
        /* Try to find the file link in the row */
        var fileLinks = row.querySelectorAll('a[href*="/uploads/forms/comments/"]');
        if (fileLinks.length > 0) {
          photoPath = fileLinks[0].getAttribute('href');
          photoUrl = photoPath.startsWith('http') ? photoPath : 'https://www.renters.com' + photoPath;
        }
      }

      cards.push({
        inquiryId: inquiryId,
        memberId: memberId,
        name: name,
        email: email,
        location: '',
        memberType: memberType,
        submitted: submitted,
        photoPath: photoPath,
        photoUrl: photoUrl,
        status: 'pending'
      });
    });

    if (cards.length === 0) {
      document.getElementById('rq-list').innerHTML = '<div class="rq-loading">Could not parse inquiry data from this page. Make sure you\'re filtered to verify_business submissions.</div>';
      return;
    }

    allCards = cards;
    document.getElementById('rq-sub').textContent = cards.length + ' verification submission' + (cards.length !== 1 ? 's' : '') + ' found';
    document.getElementById('rq-filters').style.display = 'flex';
    document.getElementById('rq-count').textContent = cards.length + ' showing';
    renderCards();
  }

  function processInquiries(data) {
    if (!data || !data.data || data.data.length === 0) {
      loadFromCurrentPage();
      return;
    }
    /* Process API response */
    allCards = data.data.map(function(item, idx) {
      var photoPath = item.file || item.comment_file || '';
      var photoUrl = photoPath ? 'https://www.renters.com' + photoPath : '';
      return {
        inquiryId: item.inquiry_id || item.id || idx,
        memberId: item.user_id || item.member_id || '',
        name: item.name || item.first_name || 'Unknown',
        email: item.email || '',
        location: item.location || item.zip || '',
        memberType: item.subscription || item.member_type || 'Unknown',
        submitted: item.date || item.submitted || '',
        photoPath: photoPath,
        photoUrl: photoUrl,
        status: 'pending'
      };
    });

    document.getElementById('rq-sub').textContent = allCards.length + ' verification submission' + (allCards.length !== 1 ? 's' : '') + ' found';
    document.getElementById('rq-filters').style.display = 'flex';
    renderCards();
  }

  loadInquiries();

})();
