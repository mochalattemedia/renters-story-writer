/* Renters.com Verification Queue v2 — loaded by bookmarklet */
(function() {

  if (document.getElementById('rq-overlay')) {
    document.getElementById('rq-overlay').remove();
    document.getElementById('rq-style') && document.getElementById('rq-style').remove();
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
      grid-template-columns: 200px 1fr auto; gap: 16px; align-items: start;
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
    .rq-completion { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .rq-completion-full { background: #d4efdf; color: #1e8449; }
    .rq-completion-partial { background: #fef9e7; color: #7d6608; }
    .rq-actions { display: flex; flex-direction: column; gap: 8px; min-width: 110px; }
    .rq-btn { padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; width: 100%; font-family: Arial, sans-serif; }
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
      <p id="rq-sub">Loading submissions...</p>
      <div class="rq-filters" id="rq-filters" style="display:none;">
        <button class="rq-filter-btn active" onclick="rqFilter('all')">All</button>
        <button class="rq-filter-btn" onclick="rqFilter('pending')">Pending</button>
        <button class="rq-filter-btn" onclick="rqFilter('approved')">Approved</button>
        <button class="rq-filter-btn" onclick="rqFilter('rejected')">Rejected</button>
        <span id="rq-count"></span>
      </div>
      <div id="rq-list"><div class="rq-loading">Parsing verification submissions from page...</div></div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('rq-close').onclick = function() {
    overlay.remove();
    styleEl.remove();
    delete window.rqFilter;
    delete window.rqApprove;
    delete window.rqReject;
    delete window.rqViewPhoto;
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

  function cleanName(raw) {
    if (!raw) return 'Unknown';
    return raw
      .replace(/IP\s+Address:?\s*[\d\w:.]+/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

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
      var completionClass = c.completion === '100%' ? 'rq-completion-full' : 'rq-completion-partial';

      var photoHtml = '';
      if (c.photoUrl) {
        photoHtml = '<img class="rq-photo" src="' + c.photoUrl + '" onerror="this.outerHTML=\'<div class=rq-photo-missing>Photo not found or already deleted</div>\'">' +
          '<a class="rq-photo-link" href="' + c.photoUrl + '" target="_blank">Open full size ↗</a>';
      } else if (c.photoLoading) {
        photoHtml = '<div class="rq-photo-loading">Loading photo...</div>';
      } else {
        photoHtml = '<div class="rq-photo-missing">⚠️ No photo submitted</div>';
      }

      var actionsHtml = '';
      if (c.status === 'pending') {
        actionsHtml = `
          <button class="rq-btn rq-approve" onclick="rqApprove('${c.inquiryId}','${c.memberId}','${c.photoPath}','${c.email}','${c.name}')">✓ Approve</button>
          <button class="rq-btn rq-reject" onclick="rqReject('${c.inquiryId}','${c.memberId}','${c.photoPath}','${c.email}','${c.name}')">✗ Reject</button>
          ${c.profileUrl ? '<a class="rq-btn rq-view" href="' + c.profileUrl + '" target="_blank">View Profile</a>' : ''}
        `;
      } else {
        actionsHtml = '<div class="rq-status rq-status-' + c.status + '">' + (c.status === 'approved' ? '✓ Approved' : '✗ Rejected') + '</div>';
        if (c.profileUrl) {
          actionsHtml += '<a class="rq-btn rq-view" href="' + c.profileUrl + '" target="_blank" style="display:block;text-align:center;text-decoration:none;margin-top:8px;">View Profile</a>';
        }
      }

      return `
        <div class="rq-card ${c.photoUrl ? '' : 'no-photo'}" id="rq-card-${c.inquiryId}">
          <div class="rq-photo-wrap">${photoHtml}</div>
          <div>
            <p class="rq-name">${c.name}</p>
            <p class="rq-meta">
              <span class="rq-badge ${badgeClass}">${c.memberType}</span>
              <span class="rq-completion ${completionClass}">${c.completion} complete</span>
            </p>
            <p class="rq-meta">Member #${c.memberId}</p>
            <p class="rq-meta">📧 ${c.email}</p>
            <p class="rq-meta">📅 Submitted: ${c.submitted}</p>
            <p class="rq-meta">📋 Inquiry #${c.inquiryId}</p>
          </div>
          <div class="rq-actions">${actionsHtml}</div>
        </div>
      `;
    }).join('');
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
    var mailtoUrl = 'mailto:' + email + '?subject=' + subject + '&body=' + body + '&from=verification@renters.com';
    window.open(mailtoUrl);
  }

  function deletePhoto(photoPath) {
    if (!photoPath) return Promise.resolve();
    return fetch('https://ww2.managemydirectory.com/admin/fileaddon/delete', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'file=' + encodeURIComponent(photoPath)
    });
  }

  function disableCardButtons(inquiryId) {
    var btns = document.querySelectorAll('#rq-card-' + inquiryId + ' .rq-btn');
    btns.forEach(function(b) { b.disabled = true; b.textContent = 'Processing...'; });
  }

  window.rqApprove = function(inquiryId, memberId, photoPath, email, name) {
    if (!confirm('Approve ' + name + ' (Member #' + memberId + ')?\n\nThis will set their account to verified and delete their verification photo.')) return;
    disableCardButtons(inquiryId);
    var card = allCards.find(function(c) { return c.inquiryId === inquiryId; });

    fetch('https://ww2.managemydirectory.com/admin/go.php?widget=Admin-Module-Members&action=update_member&user_id=' + memberId + '&verified=1&noheader=val', {
      credentials: 'include'
    }).then(function() {
      return deletePhoto(photoPath);
    }).then(function() {
      if (card) card.status = 'approved';
      renderCards();
    }).catch(function(err) {
      alert('Error approving. Please verify manually in BD admin.\n' + err);
    });
  };

  window.rqReject = function(inquiryId, memberId, photoPath, email, name) {
    if (!confirm('Reject ' + name + '\'s verification?\n\nA rejection email will open for you to review and send. Their photo will be deleted.')) return;
    disableCardButtons(inquiryId);
    var card = allCards.find(function(c) { return c.inquiryId === inquiryId; });

    deletePhoto(photoPath).then(function() {
      if (card) card.status = 'rejected';
      renderCards();
      sendRejectionEmail(email, name);
    }).catch(function(err) {
      alert('Error processing rejection.\n' + err);
    });
  };

  /* ── Parse inquiries from the current BD inbox page ── */
  function loadFromPage() {
    var cards = [];
    var rows = document.querySelectorAll('tbody tr, .views-row');

    /* Find all rows that contain verify_business */
    var verifyRows = Array.from(document.querySelectorAll('*')).filter(function(el) {
      return el.textContent && el.textContent.includes('verify_business') && el.children && el.children.length > 0;
    });

    /* Get inquiry detail blocks — look for elements containing Inquiry ID */
    var inquiryBlocks = [];
    document.querySelectorAll('td, div').forEach(function(el) {
      if (el.children.length === 0) return;
      var text = el.innerText || '';
      if (text.includes('Inquiry ID') && text.includes('Submitted') && text.includes('verify_business')) {
        inquiryBlocks.push(el);
      }
    });

    /* Alternative: find all "View Full Inquiry" buttons */
    var viewBtns = Array.from(document.querySelectorAll('button, a, input[type=button]')).filter(function(el) {
      return (el.textContent || el.value || '').trim() === 'View Full Inquiry';
    });

    if (viewBtns.length === 0 && inquiryBlocks.length === 0) {
      document.getElementById('rq-sub').textContent = 'No verify_business submissions found on this page.';
      document.getElementById('rq-list').innerHTML = '<div class="rq-loading">Please make sure you\'re on the BD Forms Inbox page filtered to verify_business submissions, then click the bookmarklet again.</div>';
      return;
    }

    var processed = new Set();

    viewBtns.forEach(function(btn, idx) {
      var container = btn.closest('tr') || btn.closest('.views-row') || btn.parentElement;
      if (!container) return;

      var text = container.innerText || container.textContent || '';

      /* Skip non-verify forms */
      if (!text.includes('verify_business')) return;

      /* Extract inquiry ID */
      var inquiryMatch = text.match(/Inquiry ID[:\s#]+(\d+)/i);
      var inquiryId = inquiryMatch ? inquiryMatch[1] : 'i' + idx;
      if (processed.has(inquiryId)) return;
      processed.add(inquiryId);

      /* Extract member ID */
      var memberMatch = text.match(/Member ID #(\d+)/i) || container.innerHTML.match(/user_id[=\/](\d+)/i);
      var memberId = memberMatch ? memberMatch[1] : '';

      /* Extract name — find member link text */
      var memberLink = container.querySelector('a[href*="user_id"], a[href*="member_id"]');
      var rawName = memberLink ? memberLink.textContent.trim() : '';
      if (!rawName) {
        var nameMatch = text.match(/Member ID #\d+\s*[-–·]\s*([^\n\r\t]+)/i);
        rawName = nameMatch ? nameMatch[1].trim() : 'Unknown';
      }
      var name = cleanName(rawName);

      /* Extract email */
      var emailMatch = text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
      var email = emailMatch ? emailMatch[0] : '';

      /* Extract submitted date */
      var dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
      var submitted = dateMatch ? dateMatch[1] : '';

      /* Extract member type from badge or text */
      var memberType = 'Unknown';
      var typeMatch = text.match(/Plan:\s*(Renter|Landlord|Property Manager|Realtor)/i);
      if (typeMatch) memberType = typeMatch[1];
      else if (text.match(/\bRenter\b/i)) memberType = 'Renter';
      else if (text.match(/\bLandlord\b/i)) memberType = 'Landlord';

      /* Profile link */
      var profileUrl = memberId ? 'https://ww2.managemydirectory.com/admin/go.php?widget=Admin-Module-Members&action=edit_member&user_id=' + memberId : '';

      cards.push({
        inquiryId: inquiryId,
        memberId: memberId,
        name: name,
        email: email,
        memberType: memberType,
        submitted: submitted,
        completion: 'Unknown',
        photoPath: '',
        photoUrl: '',
        photoLoading: memberId ? true : false,
        profileUrl: profileUrl,
        status: 'pending'
      });
    });

    if (cards.length === 0) {
      document.getElementById('rq-list').innerHTML = '<div class="rq-loading">Could not parse submissions. Make sure the inbox is filtered to verify_business and try again.</div>';
      return;
    }

    allCards = cards;
    document.getElementById('rq-sub').textContent = cards.length + ' verification submission' + (cards.length !== 1 ? 's' : '') + ' found — loading photos...';
    document.getElementById('rq-filters').style.display = 'flex';
    renderCards();

    /* Now fetch photo for each card by loading the inquiry detail */
    loadPhotosForCards(cards);
  }

  function loadPhotosForCards(cards) {
    var pending = cards.filter(function(c) { return c.memberId && c.photoLoading; });
    var loaded = 0;

    pending.forEach(function(card, i) {
      setTimeout(function() {
        /* Fetch the inquiry detail page for this member to get the file link */
        fetch('https://ww2.managemydirectory.com/admin/go.php?widget=Admin-Module-Form-Inquiries&noheader=val&action=view_inquiry&form_name=verify_business&user_id=' + card.memberId, {
          credentials: 'include'
        })
        .then(function(r) { return r.text(); })
        .then(function(html) {
          /* Look for file path in response */
          var fileMatch = html.match(/\/uploads\/forms\/comments\/[\w\-\.]+\.jpg/i);
          if (fileMatch) {
            card.photoPath = fileMatch[0];
            card.photoUrl = 'https://www.renters.com' + fileMatch[0];
          }
          card.photoLoading = false;
          loaded++;
          if (loaded === pending.length) {
            document.getElementById('rq-sub').textContent = allCards.length + ' verification submission' + (allCards.length !== 1 ? 's' : '') + ' — photos loaded';
          }
          /* Update just this card's photo */
          var photoWrap = document.querySelector('#rq-card-' + card.inquiryId + ' .rq-photo-wrap');
          if (photoWrap) {
            if (card.photoUrl) {
              photoWrap.innerHTML = '<img class="rq-photo" src="' + card.photoUrl + '" onerror="this.outerHTML=\'<div class=rq-photo-missing>Photo not found</div>\'">' +
                '<a class="rq-photo-link" href="' + card.photoUrl + '" target="_blank">Open full size ↗</a>';
            } else {
              photoWrap.innerHTML = '<div class="rq-photo-missing">⚠️ No photo submitted</div>';
              var cardEl = document.getElementById('rq-card-' + card.inquiryId);
              if (cardEl) cardEl.classList.add('no-photo');
            }
          }
          /* Update approve/reject buttons with photo path */
          var approveBtn = document.querySelector('#rq-card-' + card.inquiryId + ' .rq-approve');
          var rejectBtn = document.querySelector('#rq-card-' + card.inquiryId + ' .rq-reject');
          if (approveBtn) approveBtn.setAttribute('onclick', "rqApprove('" + card.inquiryId + "','" + card.memberId + "','" + card.photoPath + "','" + card.email + "','" + card.name + "')");
          if (rejectBtn) rejectBtn.setAttribute('onclick', "rqReject('" + card.inquiryId + "','" + card.memberId + "','" + card.photoPath + "','" + card.email + "','" + card.name + "')");
        })
        .catch(function() {
          card.photoLoading = false;
          loaded++;
        });
      }, i * 300);
    });
  }

  loadFromPage();

})();
