/* Renters.com Verification Queue v3 */
(function() {

  if (document.getElementById('rq-overlay')) {
    document.getElementById('rq-overlay').remove();
  }
  if (document.getElementById('rq-style')) {
    document.getElementById('rq-style').remove();
  }

  var css = `
    #rq-overlay {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.65); z-index: 99999;
      display: flex; align-items: flex-start; justify-content: center;
      padding: 20px; overflow-y: auto;
    }
    #rq-panel {
      background: #fff; border-radius: 12px; width: 100%; max-width: 920px;
      font-family: Arial, sans-serif; color: #0d2d4e;
      padding: 24px; position: relative; margin: auto;
    }
    #rq-close {
      position: absolute; top: 16px; right: 16px; background: none;
      border: none; font-size: 22px; cursor: pointer; color: #4a5a6a;
    }
    #rq-title { font-size: 20px; font-weight: 700; margin: 0 0 4px; color: #0d2d4e; }
    #rq-sub { font-size: 13px; color: #4a5a6a; margin: 0 0 16px; }
    .rq-filters { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; flex-wrap: wrap; }
    .rq-filter-btn { padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; border: 1px solid #e8eceb; background: #fff; color: #0d2d4e; }
    .rq-filter-btn.active { background: #0d2d4e; color: #fff; border-color: #0d2d4e; }
    #rq-count { font-size: 13px; color: #4a5a6a; margin-left: auto; }
    .rq-card {
      border: 1px solid #e8eceb; border-radius: 10px; padding: 16px;
      margin-bottom: 12px; display: grid;
      grid-template-columns: 200px 1fr 120px; gap: 16px; align-items: start;
    }
    .rq-card.no-photo { border-left: 3px solid #f39c12; }
    .rq-photo-wrap { width: 200px; }
    .rq-photo { width: 200px; height: 140px; object-fit: cover; border-radius: 8px; border: 1px solid #e8eceb; display: block; }
    .rq-photo-missing { width: 200px; height: 140px; background: #fef9e7; border-radius: 8px; border: 2px dashed #f39c12; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #7d6608; text-align: center; padding: 12px; box-sizing: border-box; }
    .rq-photo-loading { width: 200px; height: 140px; background: #f4f7f6; border-radius: 8px; border: 1px solid #e8eceb; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #888; }
    .rq-name { font-size: 15px; font-weight: 700; margin: 0 0 6px; color: #0d2d4e; }
    .rq-meta { font-size: 12px; color: #4a5a6a; margin: 0 0 3px; }
    .rq-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-right: 4px; }
    .rq-badge-renter { background: #d4efdf; color: #1e8449; }
    .rq-badge-landlord { background: #d6eaf8; color: #1a5276; }
    .rq-badge-other { background: #f4f7f6; color: #4a5a6a; }
    .rq-actions { display: flex; flex-direction: column; gap: 8px; }
    .rq-btn { padding: 9px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; width: 100%; font-family: Arial, sans-serif; text-align: center; text-decoration: none; display: block; box-sizing: border-box; }
    .rq-approve { background: #3a9e8f; color: #fff; }
    .rq-reject { background: #c0392b; color: #fff; }
    .rq-view { background: #f4f7f6; color: #0d2d4e; border: 1px solid #e8eceb; font-size: 12px; }
    .rq-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .rq-status { font-size: 12px; font-weight: 600; padding: 6px 8px; border-radius: 4px; text-align: center; }
    .rq-status-approved { background: #d4efdf; color: #1e8449; }
    .rq-status-rejected { background: #fadbd8; color: #922b21; }
    .rq-loading { text-align: center; padding: 40px; color: #4a5a6a; font-size: 14px; }
    .rq-photo-link { font-size: 11px; color: #2980b9; text-decoration: none; display: block; margin-top: 6px; text-align: center; }
  `;

  var styleEl = document.createElement('style');
  styleEl.id = 'rq-style';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  var overlay = document.createElement('div');
  overlay.id = 'rq-overlay';
  overlay.innerHTML = `
    <div id="rq-panel">
      <button id="rq-close" title="Close">✕</button>
      <p id="rq-title">Verification Queue</p>
      <p id="rq-sub">Parsing submissions...</p>
      <div class="rq-filters" id="rq-filters" style="display:none;">
        <button class="rq-filter-btn active" onclick="rqFilter('all')">All</button>
        <button class="rq-filter-btn" onclick="rqFilter('pending')">Pending</button>
        <button class="rq-filter-btn" onclick="rqFilter('approved')">Approved</button>
        <button class="rq-filter-btn" onclick="rqFilter('rejected')">Rejected</button>
        <span id="rq-count"></span>
      </div>
      <div id="rq-list"><div class="rq-loading">Loading...</div></div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('rq-close').onclick = function() {
    overlay.remove();
    styleEl.remove();
    delete window.rqFilter;
    delete window.rqApprove;
    delete window.rqReject;
  };

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
    list.innerHTML = filtered.map(function(c) {
      var badgeClass = c.memberType === 'Renter' ? 'rq-badge-renter' : c.memberType === 'Landlord' ? 'rq-badge-landlord' : 'rq-badge-other';

      var photoHtml = '';
      if (c.photoUrl) {
        photoHtml = '<img class="rq-photo" src="' + c.photoUrl + '" onerror="this.outerHTML=\'<div class=rq-photo-missing>Photo not found or deleted</div>\'">' +
          '<a class="rq-photo-link" href="' + c.photoUrl + '" target="_blank">Open full size ↗</a>';
      } else if (c.photoLoading) {
        photoHtml = '<div class="rq-photo-loading">Loading photo...</div>';
      } else {
        photoHtml = '<div class="rq-photo-missing">⚠️ No photo submitted</div>';
      }

      var actionsHtml = '';
      if (c.status === 'pending') {
        actionsHtml = `
          <button class="rq-btn rq-approve" id="approve-${c.inquiryId}" onclick="rqApprove('${c.inquiryId}')">✓ Approve</button>
          <button class="rq-btn rq-reject" id="reject-${c.inquiryId}" onclick="rqReject('${c.inquiryId}')">✗ Reject</button>
          ${c.profileUrl ? '<a class="rq-btn rq-view" href="' + c.profileUrl + '" target="_blank">Profile ↗</a>' : ''}
        `;
      } else {
        actionsHtml = '<div class="rq-status rq-status-' + c.status + '">' + (c.status === 'approved' ? '✓ Approved' : '✗ Rejected') + '</div>';
        if (c.profileUrl) {
          actionsHtml += '<a class="rq-btn rq-view" href="' + c.profileUrl + '" target="_blank" style="margin-top:8px;">Profile ↗</a>';
        }
      }

      return `
        <div class="rq-card ${c.photoUrl ? '' : 'no-photo'}" id="rq-card-${c.inquiryId}">
          <div class="rq-photo-wrap" id="rq-photo-${c.inquiryId}">${photoHtml}</div>
          <div>
            <p class="rq-name">${c.name}</p>
            <p class="rq-meta">
              <span class="rq-badge ${badgeClass}">${c.memberType}</span>
              Member #${c.memberId}
            </p>
            <p class="rq-meta">📧 ${c.email}</p>
            <p class="rq-meta">📅 ${c.submitted}</p>
            <p class="rq-meta">📋 Inquiry #${c.inquiryId}</p>
          </div>
          <div class="rq-actions">${actionsHtml}</div>
        </div>
      `;
    }).join('');
  }

  function deletePhoto(photoPath) {
    if (!photoPath) return Promise.resolve();
    return fetch('https://ww2.managemydirectory.com/admin/fileaddon/delete', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'file=' + encodeURIComponent(photoPath)
    });
  }

  function sendRejectionEmail(email, name) {
    var subject = encodeURIComponent('Your Renters.com verification needs a resubmission');
    var body = encodeURIComponent(
      'Hi ' + name + ',\n\n' +
      'Thank you for submitting your verification. Unfortunately we weren\'t able to approve it because the photo didn\'t meet our requirements.\n\n' +
      'We need one single photo showing:\n' +
      '- Your face, clearly visible\n' +
      '- Your government-issued ID held next to your face\n\n' +
      'Common reasons for rejection:\n' +
      '- Photo of ID only, no face visible\n' +
      '- No photo submitted at all\n' +
      '- Photo of something unrelated\n\n' +
      'Please resubmit by logging into your dashboard and clicking "Verify Your Profile" under Account Details.\n\n' +
      'If you have any questions just reply to this email.\n\n' +
      'Renters.com Support'
    );
    window.open('mailto:' + email + '?subject=' + subject + '&body=' + body);
  }

  window.rqApprove = function(inquiryId) {
    var card = allCards.find(function(c) { return c.inquiryId === inquiryId; });
    if (!card) return;
    if (!confirm('Approve ' + card.name + ' (Member #' + card.memberId + ')?\n\nThis will set their account to verified and delete their verification photo.')) return;

    document.getElementById('approve-' + inquiryId).disabled = true;
    document.getElementById('approve-' + inquiryId).textContent = 'Processing...';
    document.getElementById('reject-' + inquiryId).disabled = true;

    /* Verify the member in BD */
    fetch('https://ww2.managemydirectory.com/admin/go.php?widget=Admin-Module-Members&action=update_member&user_id=' + card.memberId + '&verified=1&noheader=val', {
      credentials: 'include'
    }).then(function() {
      return deletePhoto(card.photoPath);
    }).then(function() {
      card.status = 'approved';
      renderCards();
    }).catch(function(err) {
      alert('Error approving. Try manually in BD admin.\n' + err);
    });
  };

  window.rqReject = function(inquiryId) {
    var card = allCards.find(function(c) { return c.inquiryId === inquiryId; });
    if (!card) return;
    if (!confirm('Reject ' + card.name + '\'s verification?\n\nA rejection email draft will open. Their photo will be deleted.')) return;

    document.getElementById('approve-' + inquiryId).disabled = true;
    document.getElementById('reject-' + inquiryId).disabled = true;
    document.getElementById('reject-' + inquiryId).textContent = 'Processing...';

    deletePhoto(card.photoPath).then(function() {
      card.status = 'rejected';
      renderCards();
      sendRejectionEmail(card.email, card.name);
    }).catch(function(err) {
      alert('Error processing rejection.\n' + err);
    });
  };

  /* ── Parse inquiry rows from the BD page ── */
  function parseRows() {
    var cards = [];
    var processed = new Set();

    /* Each inquiry is a tr.odd or tr.even in the main table */
    var rows = document.querySelectorAll('table.form-inquiries-table tbody tr.odd, table.form-inquiries-table tbody tr.even');

    rows.forEach(function(row, idx) {
      /* Only process verify_business rows */
      if (!row.textContent.includes('verify_business')) return;

      /* Get the inner table inside this row */
      var innerTable = row.querySelector('table.insider-table');
      if (!innerTable) return;

      /* Extract inquiry ID */
      var inquiryMatch = row.textContent.match(/Inquiry ID[:\s#]*(\d+)/i);
      var inquiryId = inquiryMatch ? inquiryMatch[1] : 'r' + idx;
      if (processed.has(inquiryId)) return;
      processed.add(inquiryId);

      /* Extract submitted date */
      var dateMatch = row.textContent.match(/Submitted[:\s]*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
      var submitted = dateMatch ? dateMatch[1] : '';

      /* Extract email — text node before the <small> tag */
      var emailTd = innerTable.querySelector('td:not([class])');
      var email = '';
      if (emailTd) {
        var emailMatch = emailTd.textContent.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
        email = emailMatch ? emailMatch[0] : '';
      }

      /* Extract member name and ID from the <a> inside <small> */
      var memberLink = innerTable.querySelector('small a[href*="viewMembers"]');
      var name = 'Unknown';
      var memberId = '';
      var profileUrl = '';
      var memberType = 'Unknown';

      if (memberLink) {
        var linkText = memberLink.textContent.trim();
        /* Format: "Member ID #3667 - Gonkerwon Zoe" */
        var nameMatch = linkText.match(/Member ID #(\d+)\s*[-–]\s*(.+)/i);
        if (nameMatch) {
          memberId = nameMatch[1];
          name = nameMatch[2].trim();
        } else {
          /* Fallback */
          var idMatch = linkText.match(/#(\d+)/);
          memberId = idMatch ? idMatch[1] : '';
          name = linkText.replace(/Member ID #\d+/i, '').replace(/[-–]/g, '').trim() || 'Unknown';
        }
        profileUrl = 'https://ww2.managemydirectory.com' + memberLink.getAttribute('href');
      }

      /* Try to get member type from profile link or page */
      if (row.textContent.match(/\bRenter\b/i)) memberType = 'Renter';
      else if (row.textContent.match(/\bLandlord\b/i)) memberType = 'Landlord';
      else if (row.textContent.match(/\bProperty Manager\b/i)) memberType = 'Property Manager';

      cards.push({
        inquiryId: inquiryId,
        memberId: memberId,
        name: name,
        email: email,
        memberType: memberType,
        submitted: submitted,
        photoPath: '',
        photoUrl: '',
        photoLoading: !!memberId,
        profileUrl: profileUrl,
        status: 'pending'
      });
    });

    return cards;
  }

  var cards = parseRows();

  if (cards.length === 0) {
    document.getElementById('rq-sub').textContent = 'No verify_business submissions found on this page.';
    document.getElementById('rq-list').innerHTML = '<div class="rq-loading">Make sure you\'re on the BD Forms Inbox page filtered to verify_business submissions, then click the bookmarklet again.</div>';
    return;
  }

  allCards = cards;
  document.getElementById('rq-sub').textContent = cards.length + ' verification submission' + (cards.length !== 1 ? 's' : '') + ' — loading photos...';
  document.getElementById('rq-filters').style.display = 'flex';
  document.getElementById('rq-count').textContent = cards.length + ' showing';
  renderCards();

  /* Load photos by fetching each inquiry detail */
  cards.forEach(function(card, i) {
    if (!card.memberId) return;
    setTimeout(function() {
      /* Try to find the file link by fetching the inquiry detail */
      fetch('https://ww2.managemydirectory.com/admin/go.php?widget=Admin-Module-Form-Inquiries&noheader=val&action=view_inquiry&inquiry_id=' + card.inquiryId, {
        credentials: 'include'
      })
      .then(function(r) { return r.text(); })
      .then(function(html) {
        var fileMatch = html.match(/\/uploads\/forms\/comments\/[^"'\s]+\.jpg/i);
        if (!fileMatch) fileMatch = html.match(/\/uploads\/forms\/comments\/[^"'\s]+\.(jpg|jpeg|png|gif)/i);
        
        card.photoLoading = false;
        if (fileMatch) {
          card.photoPath = fileMatch[0];
          card.photoUrl = 'https://www.renters.com' + fileMatch[0];
          var photoWrap = document.getElementById('rq-photo-' + card.inquiryId);
          if (photoWrap) {
            photoWrap.innerHTML = '<img class="rq-photo" src="' + card.photoUrl + '" onerror="this.outerHTML=\'<div class=rq-photo-missing>Photo not found</div>\'">' +
              '<a class="rq-photo-link" href="' + card.photoUrl + '" target="_blank">Open full size ↗</a>';
            var cardEl = document.getElementById('rq-card-' + card.inquiryId);
            if (cardEl) cardEl.classList.remove('no-photo');
          }
        } else {
          var photoWrap = document.getElementById('rq-photo-' + card.inquiryId);
          if (photoWrap) {
            photoWrap.innerHTML = '<div class="rq-photo-missing">⚠️ No photo submitted</div>';
          }
          var cardEl = document.getElementById('rq-card-' + card.inquiryId);
          if (cardEl) cardEl.classList.add('no-photo');
        }

        /* Check if all photos loaded */
        var stillLoading = allCards.some(function(c) { return c.photoLoading; });
        if (!stillLoading) {
          document.getElementById('rq-sub').textContent = allCards.length + ' verification submission' + (allCards.length !== 1 ? 's' : '') + ' — photos loaded';
        }
      })
      .catch(function() {
        card.photoLoading = false;
      });
    }, i * 400);
  });

})();
