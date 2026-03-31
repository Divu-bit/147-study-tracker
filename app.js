/* ============================================
   147 Study — Core Application Logic
   Backend API version
   ============================================ */

// ─── Utilities ───────────────────────────────

function getToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(dateStr) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function daysBetween(d1, d2) {
    return Math.round((new Date(d2 + 'T00:00:00') - new Date(d1 + 'T00:00:00')) / (1000 * 60 * 60 * 24));
}

function relativeDay(dateStr) {
    const diff = daysBetween(getToday(), dateStr);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff > 0) return `In ${diff} day${diff > 1 ? 's' : ''}`;
    return `${Math.abs(diff)} day${Math.abs(diff) > 1 ? 's' : ''} ago`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ─── Main Application ────────────────────────

class StudyTracker {
    constructor() {
        this.entries = [];
        this.linkCode = localStorage.getItem('147_linkCode') || null;
        this.isLinked = false;
        this.currentTab = 'today';
        this.calYear = new Date().getFullYear();
        this.calMonth = new Date().getMonth();
        this.linkPollInterval = null;

        this.cacheDOM();
        this.bindEvents();
        this.updateDayPreviews();
        this.init();
    }

    // ─── Async Initialization ────────────────

    async init() {
        if (!this.linkCode) {
            await this.createLink();
        }
        await this.checkLinkStatus();
        await this.loadEntries();
        this.render();

        if (!this.isLinked) {
            this.startLinkPolling();
        }
    }

    async createLink() {
        try {
            const res = await fetch('/api/link', { method: 'POST' });
            const data = await res.json();
            this.linkCode = data.linkCode;
            this.botLink = data.botLink;
            localStorage.setItem('147_linkCode', this.linkCode);
        } catch (e) {
            console.error('Failed to create link:', e);
        }
    }

    async checkLinkStatus() {
        if (!this.linkCode) return;
        try {
            const res = await fetch(`/api/link-status/${this.linkCode}`);
            if (res.ok) {
                const data = await res.json();
                this.isLinked = data.linked;
            }
        } catch (e) {
            console.error('Failed to check link status:', e);
        }
        this.updateTelegramUI();
    }

    startLinkPolling() {
        this.linkPollInterval = setInterval(async () => {
            await this.checkLinkStatus();
            if (this.isLinked) {
                clearInterval(this.linkPollInterval);
                this.showToast('✅ Telegram linked successfully!');
            }
        }, 3000);
    }

    // ─── API Data Layer ──────────────────────

    async loadEntries() {
        if (!this.linkCode) return;
        try {
            const res = await fetch(`/api/entries/${this.linkCode}`);
            if (res.ok) this.entries = await res.json();
        } catch (e) {
            console.error('Failed to load entries:', e);
        }
    }

    async addEntry(subject, topic, notes) {
        const today = getToday();
        const body = {
            linkCode: this.linkCode,
            date: today,
            subject: subject.trim(),
            topic: topic.trim(),
            notes: notes.trim(),
            revisions: {
                day4: { dueDate: addDays(today, 3), completed: false, completedAt: null },
                day7: { dueDate: addDays(today, 6), completed: false, completedAt: null }
            }
        };
        try {
            const res = await fetch('/api/entries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.ok) {
                const entry = await res.json();
                this.entries.unshift(entry);
                return entry;
            }
        } catch (e) {
            console.error('Failed to add entry:', e);
        }
        return null;
    }

    async deleteEntry(id) {
        try {
            await fetch(`/api/entries/${this.linkCode}/${id}`, { method: 'DELETE' });
            this.entries = this.entries.filter(e => e._id !== id);
        } catch (e) {
            console.error('Failed to delete:', e);
        }
    }

    async markRevisionComplete(entryId, type) {
        try {
            await fetch(`/api/entries/${this.linkCode}/${entryId}/revise`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type })
            });
            const entry = this.entries.find(e => e._id === entryId);
            if (entry) {
                entry.revisions[type].completed = true;
                entry.revisions[type].completedAt = new Date().toISOString();
            }
        } catch (e) {
            console.error('Failed to mark revision:', e);
        }
    }

    // ─── DOM Caching ─────────────────────────

    cacheDOM() {
        this.dom = {
            content: document.getElementById('content'),
            tabs: document.getElementById('tabs'),
            addBtn: document.getElementById('addBtn'),
            addModal: document.getElementById('addModal'),
            addModalClose: document.getElementById('addModalClose'),
            addForm: document.getElementById('addForm'),
            entrySubject: document.getElementById('entrySubject'),
            entryTopic: document.getElementById('entryTopic'),
            entryNotes: document.getElementById('entryNotes'),
            day4Preview: document.getElementById('day4Preview'),
            day7Preview: document.getElementById('day7Preview'),
            calendarGrid: document.getElementById('calendarGrid'),
            calTitle: document.getElementById('calTitle'),
            calPrev: document.getElementById('calPrev'),
            calNext: document.getElementById('calNext'),
            statTopics: document.getElementById('statTopics'),
            statRevised: document.getElementById('statRevised'),
            statPending: document.getElementById('statPending'),
            streakCount: document.getElementById('streakCount'),
            todayBadge: document.getElementById('todayBadge'),
            telegramBtn: document.getElementById('telegramBtn'),
            telegramIcon: document.getElementById('telegramIcon'),
            telegramLabel: document.getElementById('telegramLabel'),
            telegramBanner: document.getElementById('telegramBanner'),
            telegramBannerBtn: document.getElementById('telegramBannerBtn'),
            logoutBtn: document.getElementById('logoutBtn'),
            deleteAccountBtn: document.getElementById('deleteAccountBtn')
        };
    }

    // ─── Event Binding ───────────────────────

    bindEvents() {
        // Tabs
        this.dom.tabs.addEventListener('click', (e) => {
            const tab = e.target.closest('.tab');
            if (!tab) return;
            this.currentTab = tab.dataset.tab;
            this.dom.tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            this.renderContent();
        });

        // FAB & Add Modal
        this.dom.addBtn.addEventListener('click', () => this.openModal('addModal'));
        this.dom.addModalClose.addEventListener('click', () => this.closeModal('addModal'));
        this.dom.addModal.addEventListener('click', (e) => {
            if (e.target === this.dom.addModal) this.closeModal('addModal');
        });

        // Add Form
        this.dom.addForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAddEntry();
        });

        // Telegram link
        this.dom.telegramBtn.addEventListener('click', () => this.openTelegramLink());
        this.dom.telegramBannerBtn.addEventListener('click', () => this.openTelegramLink());

        // Logout & Delete Account
        this.dom.logoutBtn.addEventListener('click', () => this.handleLogout());
        this.dom.deleteAccountBtn.addEventListener('click', () => this.handleDeleteAccount());

        // Calendar nav
        this.dom.calPrev.addEventListener('click', () => {
            this.calMonth--;
            if (this.calMonth < 0) { this.calMonth = 11; this.calYear--; }
            this.renderCalendar();
        });
        this.dom.calNext.addEventListener('click', () => {
            this.calMonth++;
            if (this.calMonth > 11) { this.calMonth = 0; this.calYear++; }
            this.renderCalendar();
        });

        // Content event delegation
        this.dom.content.addEventListener('click', (e) => {
            const completeBtn = e.target.closest('.btn-complete');
            if (completeBtn) {
                this.handleMarkComplete(completeBtn.dataset.entryId, completeBtn.dataset.type, completeBtn.closest('.card'));
                return;
            }
            const deleteBtn = e.target.closest('.btn-delete');
            if (deleteBtn) {
                this.handleDelete(deleteBtn.dataset.entryId, deleteBtn.closest('.card'));
            }
        });

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeModal('addModal');
        });
    }

    // ─── Telegram UI ─────────────────────────

    openTelegramLink() {
        if (this.isLinked) return;
        const link = this.botLink || `https://t.me/Edu147plannerbot?start=${this.linkCode}`;
        window.open(link, '_blank');
    }

    updateTelegramUI() {
        if (this.isLinked) {
            this.dom.telegramIcon.textContent = '✅';
            this.dom.telegramLabel.textContent = 'Connected';
            this.dom.telegramBtn.classList.add('linked');
            this.dom.telegramBanner.style.display = 'none';
            this.dom.logoutBtn.style.display = 'flex';
            this.dom.deleteAccountBtn.style.display = 'flex';
        } else {
            this.dom.telegramIcon.textContent = '📬';
            this.dom.telegramLabel.textContent = 'Link Telegram';
            this.dom.telegramBtn.classList.remove('linked');
            this.dom.telegramBanner.style.display = 'flex';
            this.dom.logoutBtn.style.display = 'none';
            this.dom.deleteAccountBtn.style.display = 'none';
        }
    }

    handleLogout() {
        if (!confirm('Log out? You can re-link your Telegram anytime to restore your data.')) return;
        if (this.linkPollInterval) clearInterval(this.linkPollInterval);
        localStorage.removeItem('147_linkCode');
        window.location.reload();
    }

    async handleDeleteAccount() {
        if (!confirm('⚠️ DELETE ACCOUNT?\n\nThis will permanently:\n• Unlink your Telegram\n• Delete ALL your study entries\n\nThis cannot be undone!')) return;
        if (!confirm('Are you ABSOLUTELY sure? All your data will be gone forever.')) return;

        try {
            const res = await fetch(`/api/account/${this.linkCode}`, { method: 'DELETE' });
            if (res.ok) {
                const data = await res.json();
                if (this.linkPollInterval) clearInterval(this.linkPollInterval);
                localStorage.removeItem('147_linkCode');
                this.showToast(`Account deleted. ${data.entriesDeleted} entries wiped.`);
                setTimeout(() => window.location.reload(), 1500);
            } else {
                this.showToast('Failed to delete account. Try again.', 'error');
            }
        } catch (e) {
            console.error('Delete account error:', e);
            this.showToast('Failed to delete account.', 'error');
        }
    }

    // ─── Queries ─────────────────────────────

    getDueToday() {
        const today = getToday();
        const results = [];
        this.entries.forEach(entry => {
            if (entry.revisions.day4.dueDate === today && !entry.revisions.day4.completed)
                results.push({ entry, type: 'day4', dueDate: entry.revisions.day4.dueDate });
            if (entry.revisions.day7.dueDate === today && !entry.revisions.day7.completed)
                results.push({ entry, type: 'day7', dueDate: entry.revisions.day7.dueDate });
        });
        return results;
    }

    getOverdue() {
        const today = getToday();
        const results = [];
        this.entries.forEach(entry => {
            if (entry.revisions.day4.dueDate < today && !entry.revisions.day4.completed)
                results.push({ entry, type: 'day4', dueDate: entry.revisions.day4.dueDate, overdueDays: daysBetween(entry.revisions.day4.dueDate, today) });
            if (entry.revisions.day7.dueDate < today && !entry.revisions.day7.completed)
                results.push({ entry, type: 'day7', dueDate: entry.revisions.day7.dueDate, overdueDays: daysBetween(entry.revisions.day7.dueDate, today) });
        });
        return results;
    }

    getUpcoming() {
        const today = getToday();
        const results = [];
        this.entries.forEach(entry => {
            if (entry.revisions.day4.dueDate > today && !entry.revisions.day4.completed)
                results.push({ entry, type: 'day4', dueDate: entry.revisions.day4.dueDate, inDays: daysBetween(today, entry.revisions.day4.dueDate) });
            if (entry.revisions.day7.dueDate > today && !entry.revisions.day7.completed)
                results.push({ entry, type: 'day7', dueDate: entry.revisions.day7.dueDate, inDays: daysBetween(today, entry.revisions.day7.dueDate) });
        });
        results.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        return results;
    }

    getCompleted() {
        return this.entries.filter(e => e.revisions.day4.completed && e.revisions.day7.completed);
    }

    getAllEntries() {
        return [...this.entries].sort((a, b) => b.date.localeCompare(a.date));
    }

    // ─── Stats ───────────────────────────────

    getStats() {
        const today = getToday();
        let totalRevisions = 0, pendingToday = 0;
        this.entries.forEach(entry => {
            if (entry.revisions.day4.completed) totalRevisions++;
            if (entry.revisions.day7.completed) totalRevisions++;
            if (entry.revisions.day4.dueDate <= today && !entry.revisions.day4.completed) pendingToday++;
            if (entry.revisions.day7.dueDate <= today && !entry.revisions.day7.completed) pendingToday++;
        });

        let streak = 0, checkDate = getToday();
        while (true) {
            const has = this.entries.some(entry => {
                if (entry.date === checkDate) return true;
                const d4c = entry.revisions.day4.completedAt;
                const d7c = entry.revisions.day7.completedAt;
                if (d4c && d4c.substring(0, 10) === checkDate) return true;
                if (d7c && d7c.substring(0, 10) === checkDate) return true;
                return false;
            });
            if (has) { streak++; checkDate = addDays(checkDate, -1); } else break;
        }
        return { totalTopics: this.entries.length, totalRevisions, pendingToday, streak };
    }

    // ─── Rendering ───────────────────────────

    render() {
        this.renderStats();
        this.renderContent();
        this.renderCalendar();
    }

    renderStats() {
        const stats = this.getStats();
        this.dom.statTopics.textContent = stats.totalTopics;
        this.dom.statRevised.textContent = stats.totalRevisions;
        this.dom.statPending.textContent = stats.pendingToday;
        this.dom.streakCount.textContent = stats.streak;
        this.dom.todayBadge.textContent = this.getDueToday().length + this.getOverdue().length;
    }

    renderContent() {
        switch (this.currentTab) {
            case 'today': this.renderTodayTab(); break;
            case 'upcoming': this.renderUpcomingTab(); break;
            case 'all': this.renderAllTab(); break;
            case 'completed': this.renderCompletedTab(); break;
        }
    }

    renderTodayTab() {
        const overdue = this.getOverdue();
        const due = this.getDueToday();
        const all = [...overdue.map(i => ({ ...i, isOverdue: true })), ...due];
        if (!all.length) {
            this.dom.content.innerHTML = this.emptyState('🎯', 'All caught up!', 'No revisions due today. Keep studying and logging!');
            return;
        }
        let html = '<div class="cards-grid">';
        all.forEach(item => { html += this.renderRevisionCard(item); });
        html += '</div>';
        this.dom.content.innerHTML = html;
    }

    renderUpcomingTab() {
        const upcoming = this.getUpcoming();
        if (!upcoming.length) {
            this.dom.content.innerHTML = this.emptyState('📚', 'No upcoming revisions', 'Start logging study topics to schedule revisions!');
            return;
        }
        const groups = {};
        upcoming.forEach(item => { (groups[item.dueDate] = groups[item.dueDate] || []).push(item); });
        let html = '';
        Object.keys(groups).sort().forEach(date => {
            html += `<div class="date-group-header">${relativeDay(date)} — ${formatDateShort(date)}</div><div class="cards-grid">`;
            groups[date].forEach(item => { html += this.renderRevisionCard(item, false); });
            html += '</div>';
        });
        this.dom.content.innerHTML = html;
    }

    renderAllTab() {
        const entries = this.getAllEntries();
        if (!entries.length) {
            this.dom.content.innerHTML = this.emptyState('✨', 'No entries yet', 'Click the + button to log your first study topic!');
            return;
        }
        const groups = {};
        entries.forEach(e => { (groups[e.date] = groups[e.date] || []).push(e); });
        let html = '';
        Object.keys(groups).sort().reverse().forEach(date => {
            html += `<div class="date-group-header">${relativeDay(date)} — ${formatDate(date)}</div><div class="cards-grid">`;
            groups[date].forEach(entry => { html += this.renderEntryCard(entry); });
            html += '</div>';
        });
        this.dom.content.innerHTML = html;
    }

    renderCompletedTab() {
        const completed = this.getCompleted();
        if (!completed.length) {
            this.dom.content.innerHTML = this.emptyState('🏆', 'No completed revisions', 'Your fully revised topics will appear here!');
            return;
        }
        let html = '<div class="cards-grid">';
        completed.forEach(entry => { html += this.renderCompletedCard(entry); });
        html += '</div>';
        this.dom.content.innerHTML = html;
    }

    renderRevisionCard(item, showAction = true) {
        const { entry, type, isOverdue, overdueDays } = item;
        const typeLabel = type === 'day4' ? 'Day 4 Revision' : 'Day 7 Revision';
        const typeIcon = type === 'day4' ? '🟣' : '🔵';
        const cardClass = isOverdue ? 'card-overdue' : (type === 'day4' ? 'card-day4' : 'card-day7');
        const overdueText = isOverdue ? ` · ${overdueDays}d overdue` : '';
        const displayType = isOverdue ? `⚠️ OVERDUE — ${typeLabel}` : `${typeIcon} ${typeLabel}`;

        return `<div class="card ${cardClass}">
            <div class="card-type">${displayType}${overdueText}</div>
            <div class="card-subject">${escapeHtml(entry.subject)}</div>
            <div class="card-topic">${escapeHtml(entry.topic)}</div>
            ${entry.notes ? `<div class="card-notes">"${escapeHtml(entry.notes)}"</div>` : ''}
            <div class="card-dates">
                <span>📅 Studied: ${formatDateShort(entry.date)}</span>
                <span>⏰ Due: ${formatDateShort(item.dueDate)}</span>
            </div>
            <div class="card-actions">
                ${showAction ? `<button class="btn-complete" data-entry-id="${entry._id}" data-type="${type}">✓ Mark as Revised</button>` : ''}
                <button class="btn-delete" data-entry-id="${entry._id}" title="Delete">🗑️</button>
            </div></div>`;
    }

    renderEntryCard(entry) {
        const today = getToday();
        const d4 = entry.revisions.day4, d7 = entry.revisions.day7;
        const badge = (rev, date, label) => {
            const cls = rev.completed ? 'done' : (date < today ? 'overdue-badge' : (date === today ? 'due' : 'pending'));
            const icon = rev.completed ? '✓' : (date < today ? '⚠' : (date === today ? '●' : '○'));
            return `<span class="rev-badge ${cls}">${icon} ${label} · ${formatDateShort(date)}</span>`;
        };
        return `<div class="card card-entry">
            <div class="card-subject">${escapeHtml(entry.subject)}</div>
            <div class="card-topic">${escapeHtml(entry.topic)}</div>
            ${entry.notes ? `<div class="card-notes">"${escapeHtml(entry.notes)}"</div>` : ''}
            <div class="revision-status">
                ${badge(d4, d4.dueDate, 'Day 4')}
                ${badge(d7, d7.dueDate, 'Day 7')}
            </div>
            <div class="card-actions">
                <button class="btn-delete" data-entry-id="${entry._id}" title="Delete">🗑️</button>
            </div></div>`;
    }

    renderCompletedCard(entry) {
        return `<div class="card card-completed">
            <div class="card-type">✅ Completed</div>
            <div class="card-subject">${escapeHtml(entry.subject)}</div>
            <div class="card-topic">${escapeHtml(entry.topic)}</div>
            <div class="card-dates">
                <span>📅 Studied: ${formatDateShort(entry.date)}</span>
                <span>✓ Both revisions done</span>
            </div>
            <div class="card-actions">
                <button class="btn-delete" data-entry-id="${entry._id}" title="Delete">🗑️</button>
            </div></div>`;
    }

    emptyState(icon, title, text) {
        return `<div class="empty-state">
            <div class="empty-state-icon">${icon}</div>
            <div class="empty-state-title">${title}</div>
            <div class="empty-state-text">${text}</div>
        </div>`;
    }

    // ─── Calendar ────────────────────────────

    renderCalendar() {
        const today = getToday();
        const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        this.dom.calTitle.textContent = `${months[this.calMonth]} ${this.calYear}`;

        const firstDay = new Date(this.calYear, this.calMonth, 1);
        const lastDay = new Date(this.calYear, this.calMonth + 1, 0);
        const startDow = (firstDay.getDay() + 6) % 7;

        const dataMap = {};
        this.entries.forEach(entry => {
            const sd = entry.date, d4d = entry.revisions.day4.dueDate, d7d = entry.revisions.day7.dueDate;
            if (!dataMap[sd]) dataMap[sd] = {};
            dataMap[sd].study = true;
            if (!dataMap[d4d]) dataMap[d4d] = {};
            dataMap[d4d].day4 = true;
            if (!dataMap[d7d]) dataMap[d7d] = {};
            dataMap[d7d].day7 = true;
        });

        let html = '';
        ['Mo','Tu','We','Th','Fr','Sa','Su'].forEach(d => { html += `<div class="cal-day-label">${d}</div>`; });

        const prevLast = new Date(this.calYear, this.calMonth, 0).getDate();
        for (let i = startDow - 1; i >= 0; i--) html += `<div class="cal-day other-month">${prevLast - i}</div>`;

        for (let day = 1; day <= lastDay.getDate(); day++) {
            const ds = `${this.calYear}-${String(this.calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = ds === today;
            const data = dataMap[ds];
            let dots = '';
            if (data) {
                dots = '<div class="cal-day-dots">';
                if (data.study) dots += '<span class="cal-dot dot-study"></span>';
                if (data.day4) dots += '<span class="cal-dot dot-revision"></span>';
                if (data.day7) dots += '<span class="cal-dot dot-revision7"></span>';
                dots += '</div>';
            }
            html += `<div class="cal-day${isToday ? ' today' : ''}">${day}${dots}</div>`;
        }

        const total = startDow + lastDay.getDate();
        for (let i = 1; i <= (7 - (total % 7)) % 7; i++) html += `<div class="cal-day other-month">${i}</div>`;
        this.dom.calendarGrid.innerHTML = html;
    }

    // ─── Handlers ────────────────────────────

    async handleAddEntry() {
        const subject = this.dom.entrySubject.value;
        const topic = this.dom.entryTopic.value;
        const notes = this.dom.entryNotes.value;
        if (!subject.trim() || !topic.trim()) return;

        const entry = await this.addEntry(subject, topic, notes);
        if (entry) {
            this.closeModal('addModal');
            this.dom.addForm.reset();
            this.render();
            this.showToast(`Topic logged! Revisions on ${formatDateShort(entry.revisions.day4.dueDate)} & ${formatDateShort(entry.revisions.day7.dueDate)} 📅`);
        } else {
            this.showToast('Failed to save. Try again.', 'error');
        }
    }

    async handleMarkComplete(entryId, type, cardEl) {
        if (cardEl) {
            cardEl.classList.add('card-completing');
            await new Promise(r => setTimeout(r, 400));
        }
        await this.markRevisionComplete(entryId, type);
        this.render();
        this.showToast('Revision completed! ✅');
    }

    async handleDelete(entryId, cardEl) {
        if (!confirm('Delete this entry and all its scheduled revisions?')) return;
        if (cardEl) {
            cardEl.classList.add('card-completing');
            await new Promise(r => setTimeout(r, 400));
        }
        await this.deleteEntry(entryId);
        this.render();
        this.showToast('Entry deleted');
    }

    // ─── Modals ──────────────────────────────

    openModal(id) {
        document.getElementById(id).classList.add('active');
        if (id === 'addModal') {
            this.updateDayPreviews();
            setTimeout(() => this.dom.entrySubject.focus(), 300);
        }
    }

    closeModal(id) {
        document.getElementById(id).classList.remove('active');
    }

    updateDayPreviews() {
        const today = getToday();
        this.dom.day4Preview.textContent = formatDate(addDays(today, 3));
        this.dom.day7Preview.textContent = formatDate(addDays(today, 6));
    }

    // ─── Toast ───────────────────────────────

    showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('toast-visible')));
        setTimeout(() => {
            toast.classList.remove('toast-visible');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

// ─── Initialize ──────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    window.app = new StudyTracker();
});
