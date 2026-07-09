class CryptVaultApp {
    constructor() {
        // Core State
        this.currentFolderId = 'root';
        this.token = sessionStorage.getItem('token');
        this.selectedNodes = new Set();
        
        // UI Elements
        this.setupView = document.getElementById('setup-view');
        this.setupForm = document.getElementById('setup-form');
        this.setupPasswordInput = document.getElementById('setup-password');
        this.setupConfirmInput = document.getElementById('setup-confirm');
        this.setupError = document.getElementById('setup-error');
        
        this.loginView = document.getElementById('login-view');
        this.dashboardView = document.getElementById('dashboard-view');
        this.loginForm = document.getElementById('login-form');
        this.passwordInput = document.getElementById('password');
        this.loginError = document.getElementById('login-error');
        this.logoutBtn = document.getElementById('logout-btn');
        
        this.nodeList = document.getElementById('node-list');
        this.emptyState = document.getElementById('empty-state');
        this.breadcrumbsContainer = document.getElementById('breadcrumbs');
        this.selectAllCheckbox = document.getElementById('select-all');
        this.bulkActionsBar = document.getElementById('floating-action-bar');
        this.bulkCountText = document.getElementById('bulk-count');
        
        this.fileUploadInput = document.getElementById('file-upload');
        this.folderUploadInput = document.getElementById('folder-upload');
        this.dropzone = document.getElementById('dropzone');
        
        this.uploadOverlay = document.getElementById('upload-overlay');
        this.uploadTitle = document.getElementById('upload-title');
        this.uploadFilename = document.getElementById('upload-filename');
        this.uploadPercentage = document.getElementById('upload-percentage');
        this.uploadBar = document.getElementById('upload-bar');
        this.uploadProgressText = document.getElementById('upload-progress-text');
        
        this.toast = document.getElementById('toast');
        this.toastIcon = document.getElementById('toast-icon');
        this.toastMessage = document.getElementById('toast-message');
        
        // Modals
        this.newFolderModal = document.getElementById('new-folder-modal');
        this.newFolderName = document.getElementById('new-folder-name');
        
        this.confirmModal = document.getElementById('confirm-modal');
        this.confirmMessage = document.getElementById('confirm-message');
        this.confirmBtn = document.getElementById('confirm-btn');
        this.pendingConfirmAction = null;
        
        this.settingsModal = document.getElementById('settings-modal');
        this.settingMaxUpload = document.getElementById('setting-max-upload');
        this.settings = null;
        
        this.summaryPanel = document.getElementById('upload-summary-panel');
        this.summaryDetails = document.getElementById('summary-details');
        this.summarySuccessCount = document.getElementById('summary-success-count');
        this.summaryErrorCount = document.getElementById('summary-error-count');
        this.summarySuccessList = document.getElementById('summary-success-list');
        this.summaryErrorList = document.getElementById('summary-error-list');
        this.summaryToggleIcon = document.getElementById('summary-toggle-icon');
        
        this.conflictModal = document.getElementById('conflict-modal');
        this.conflictMessage = document.getElementById('conflict-message');
        this.conflictSkipBtn = document.getElementById('conflict-skip-btn');
        this.conflictKeepBtn = document.getElementById('conflict-keep-btn');
        this.conflictReplaceBtn = document.getElementById('conflict-replace-btn');
        this.conflictListContainer = document.getElementById('conflict-list-container');
        this.conflictApplyBtn = document.getElementById('conflict-apply-btn');
        this.pendingConflictResolution = null;

        this.init();
    }

    init() {
        this.bindEvents();
        this.checkAuthStatus();
    }

    bindEvents() {
        this.setupForm.addEventListener('submit', (e) => { e.preventDefault(); this.handleSetup(); });
        this.loginForm.addEventListener('submit', (e) => { e.preventDefault(); this.handleLogin(); });
        this.logoutBtn.addEventListener('click', () => this.handleLogout());
        
        // Settings / UI
        document.getElementById('change-password-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleChangePassword();
        });
        
        const tlsCheckbox = document.getElementById('setting-net-tls');
        tlsCheckbox.addEventListener('change', (e) => {
            document.getElementById('tls-settings-container').style.display = e.target.checked ? 'flex' : 'none';
        });
        
        document.getElementById('network-settings-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveNetworkSettings();
        });
        
        document.getElementById('btn-restart-server').addEventListener('click', () => {
            this.triggerRestart();
        });
        
        this.fileUploadInput.addEventListener('change', (e) => this.handleUploads(e.target.files));
        this.folderUploadInput.addEventListener('change', (e) => this.handleUploads(e.target.files));
        
        // Drag and Drop
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            document.body.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        document.body.addEventListener('dragenter', () => {
            if (this.dashboardView.classList.contains('active-view')) {
                this.dropzone.classList.remove('hidden');
            }
        });

        this.dropzone.addEventListener('dragleave', (e) => {
            if (e.target === this.dropzone) {
                this.dropzone.classList.add('hidden');
            }
        });

        this.dropzone.addEventListener('drop', (e) => this.handleDrop(e));
        
        // Modal input enter key
        this.newFolderName.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.submitNewFolder();
        });
    }

    // --- Utilities ---
    showToast(message, type = 'success') {
        this.toast.className = `toast active ${type}`;
        this.toastMessage.textContent = message;
        this.toastIcon.className = type === 'success' ? 'ph-fill ph-check-circle' : 'ph-fill ph-warning-circle';
        
        if (this.toastTimeout) clearTimeout(this.toastTimeout);
        this.toastTimeout = setTimeout(() => {
            this.toast.classList.remove('active');
        }, 3000);
    }

    formatBytes(bytes, decimals = 2) {
        if (bytes === undefined || bytes === null) return '--';
        if (!+bytes) return '0 B';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    }

    formatDate(isoString) {
        if (!isoString) return '--';
        return new Date(isoString).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    }

    async authFetch(url, options = {}) {
        if (!this.token) throw new Error('No token found');
        const headers = { ...options.headers, 'Authorization': `Bearer ${this.token}` };
        return fetch(url, { ...options, headers });
    }

    // --- Modals ---
    closeModals() {
        if (this.newFolderModal) this.newFolderModal.classList.add('hidden');
        if (this.settingsModal) this.settingsModal.classList.add('hidden');
        if (this.confirmModal) this.confirmModal.classList.add('hidden');
        if (this.conflictModal) {
            this.conflictModal.classList.add('hidden');
            if (this.pendingConflictResolution) {
                this.pendingConflictResolution('skip');
                this.pendingConflictResolution = null;
            }
        }
        this.newFolderName.value = '';
        this.pendingConfirmAction = null;
    }
    
    openNewFolderModal() {
        this.newFolderModal.classList.remove('hidden');
        setTimeout(() => this.newFolderName.focus(), 100);
    }
    
    openConfirmModal(message, actionCallback) {
        this.confirmMessage.textContent = message;
        this.pendingConfirmAction = actionCallback;
        this.confirmModal.classList.remove('hidden');
        
        this.confirmBtn.onclick = () => {
            if (this.pendingConfirmAction) this.pendingConfirmAction();
            this.closeModals();
        };
    }

    // --- State & Auth ---
    switchView(view) {
        const views = {
            'setup': this.setupView,
            'login': this.loginView,
            'dashboard': this.dashboardView
        };
        
        // Hide all
        Object.values(views).forEach(v => {
            if (v.classList.contains('active-view')) {
                v.classList.remove('active-view');
                setTimeout(() => v.classList.add('hidden'), 400);
            } else {
                v.classList.add('hidden');
            }
        });
        
        // Show target
        setTimeout(() => {
            if (views[view]) {
                views[view].classList.remove('hidden');
                void views[view].offsetWidth;
                views[view].classList.add('active-view');
            }
            if (view === 'dashboard') {
                this.loadNodes(this.currentFolderId);
            }
        }, 400);
    }

    async checkAuthStatus() {
        try {
            const statusRes = await fetch('/api/status');
            const statusData = await statusRes.json();
            
            if (!statusData.isSetup) {
                this.switchView('setup');
                return;
            }
            
            if (!this.token) {
                this.switchView('login');
                return;
            }
            
            const res = await this.authFetch('/api/check-auth');
            const data = await res.json();
            if (data.authenticated) {
                await this.loadSettings();
                this.switchView('dashboard');
            } else {
                this.clearSession();
            }
        } catch (e) {
            this.clearSession();
        }
    }

    async handleSetup() {
        const password = this.setupPasswordInput.value;
        const confirm = this.setupConfirmInput.value;
        
        if (password !== confirm) {
            this.setupError.textContent = 'Passwords do not match';
            this.setupError.classList.remove('hidden');
            return;
        }
        
        try {
            const res = await fetch('/api/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await res.json();
            
            if (res.ok && data.success) {
                this.token = data.token;
                sessionStorage.setItem('token', this.token);
                this.setupPasswordInput.value = '';
                this.setupConfirmInput.value = '';
                this.setupError.classList.add('hidden');
                await this.loadSettings();
                this.switchView('dashboard');
            } else {
                this.setupError.textContent = data.error || 'Setup failed';
                this.setupError.classList.remove('hidden');
            }
        } catch (error) {
            this.setupError.textContent = 'Server connection error';
            this.setupError.classList.remove('hidden');
        }
    }

    async handleLogin() {
        const password = this.passwordInput.value;
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await res.json();
            
            if (res.ok && data.success) {
                this.token = data.token;
                sessionStorage.setItem('token', this.token);
                this.passwordInput.value = '';
                this.loginError.classList.add('hidden');
                await this.loadSettings();
                this.switchView('dashboard');
            } else {
                this.loginError.textContent = data.error || 'Login failed';
                this.loginError.classList.remove('hidden');
            }
        } catch (error) {
            this.loginError.textContent = 'Server connection error';
            this.loginError.classList.remove('hidden');
        }
    }

    async handleLogout() {
        try {
            await this.authFetch('/api/logout', { method: 'POST' });
        } catch(e) {}
        this.clearSession();
        this.switchView('login');
    }

    clearSession() {
        this.token = null;
        sessionStorage.removeItem('token');
    }

    // --- File System UI ---
    async loadNodes(folderId) {
        try {
            const res = await this.authFetch(`/api/nodes/${folderId}`);
            if (res.status === 401) {
                this.clearSession();
                return this.switchView('login');
            }
            
            const data = await res.json();
            if (!res.ok) {
                this.showToast(data.error || 'Failed to load folder', 'error');
                if (folderId !== 'root') this.loadNodes('root');
                return;
            }
            
            this.currentFolderId = folderId;
            this.selectedNodes.clear();
            this.updateBulkActions();
            
            this.currentFolderNodes = data.children;
            this.renderBreadcrumbs(data.breadcrumbs);
            this.renderNodes(data.children);
            
        } catch (error) {
            this.showToast('Error loading folder', 'error');
        }
    }

    renderBreadcrumbs(breadcrumbs) {
        this.breadcrumbsContainer.innerHTML = '';
        breadcrumbs.forEach((crumb, index) => {
            const span = document.createElement('span');
            span.className = 'breadcrumb-item' + (index === breadcrumbs.length - 1 ? ' active' : '');
            span.textContent = crumb.name;
            span.onclick = () => this.loadNodes(crumb.id);
            
            this.breadcrumbsContainer.appendChild(span);
            
            if (index < breadcrumbs.length - 1) {
                const sep = document.createElement('span');
                sep.className = 'breadcrumb-separator';
                sep.innerHTML = '<i class="ph ph-caret-right"></i>';
                this.breadcrumbsContainer.appendChild(sep);
            }
        });
    }

    renderNodes(childrenObj) {
        const uuids = Object.keys(childrenObj);
        
        // Clear old nodes except empty state
        Array.from(this.nodeList.children).forEach(child => {
            if (child.id !== 'empty-state') child.remove();
        });
        
        if (uuids.length === 0) {
            this.emptyState.classList.remove('hidden');
            this.selectAllCheckbox.checked = false;
            return;
        }
        
        this.emptyState.classList.add('hidden');
        
        const nodesArray = uuids.map(id => ({ id, ...childrenObj[id] }));
        nodesArray.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        
        // Check if all are selected
        this.selectAllCheckbox.checked = this.selectedNodes.size === nodesArray.length && nodesArray.length > 0;
        
        nodesArray.forEach((node, index) => {
            const el = document.createElement('div');
            el.className = 'file-item' + (this.selectedNodes.has(node.id) ? ' selected' : '');
            el.style.animationDelay = `${index * 0.03}s`;
            
            const isFolder = node.type === 'folder';
            const iconHtml = isFolder 
                ? `<div class="item-icon icon-folder"><i class="ph-fill ph-folder"></i></div>`
                : `<div class="item-icon icon-file"><i class="ph ph-file-text"></i></div>`;
            
            const actionsHtml = isFolder ? `
                <button onclick="app.downloadFolder('${node.id}', event)" class="action-btn download" title="Download ZIP">
                    <i class="ph ph-file-zip"></i>
                </button>
                <button onclick="app.deleteNodePrompt('${node.id}', event)" class="action-btn delete" title="Delete">
                    <i class="ph ph-trash"></i>
                </button>
            ` : `
                <button onclick="app.downloadFile('${node.id}', event)" class="action-btn download" title="Download">
                    <i class="ph ph-download-simple"></i>
                </button>
                <button onclick="app.deleteNodePrompt('${node.id}', event)" class="action-btn delete" title="Delete">
                    <i class="ph ph-trash"></i>
                </button>
            `;
            
            const isChecked = this.selectedNodes.has(node.id) ? 'checked' : '';
            
            el.innerHTML = `
                <div class="col-checkbox" onclick="event.stopPropagation()">
                    <label class="custom-checkbox">
                        <input type="checkbox" onchange="app.toggleSelectNode('${node.id}', this)" ${isChecked}>
                        <span class="checkmark"></span>
                    </label>
                </div>
                <div class="item-name">
                    ${iconHtml}
                    <span class="item-title"></span>
                </div>
                <div class="item-size text-right">${this.formatBytes(node.size)}</div>
                <div class="item-date text-right">${this.formatDate(node.uploadedAt || node.createdAt)}</div>
                <div class="item-actions text-center">
                    ${actionsHtml}
                </div>
            `;
            
            const titleSpan = el.querySelector('.item-title');
            titleSpan.textContent = node.name;
            titleSpan.setAttribute('title', node.name);
            
            el.onclick = () => {
                if (isFolder) this.loadNodes(node.id);
            };
            
            this.nodeList.appendChild(el);
        });
    }

    // --- Selection Logic ---
    toggleSelectNode(uuid, checkbox) {
        if (checkbox.checked) {
            this.selectedNodes.add(uuid);
            checkbox.closest('.file-item').classList.add('selected');
        } else {
            this.selectedNodes.delete(uuid);
            checkbox.closest('.file-item').classList.remove('selected');
        }
        
        this.updateBulkActions();
        
        const totalItems = this.nodeList.querySelectorAll('.file-item').length;
        this.selectAllCheckbox.checked = (totalItems > 0 && this.selectedNodes.size === totalItems);
    }
    
    async toggleSelectAll(checkbox) {
        const checkboxes = this.nodeList.querySelectorAll('.custom-checkbox input');
        
        if (checkbox.checked) {
            checkboxes.forEach(cb => {
                if (!cb.checked) {
                    cb.checked = true;
                    cb.closest('.file-item').classList.add('selected');
                    const match = cb.getAttribute('onchange').match(/'([^']+)'/);
                    if (match) this.selectedNodes.add(match[1]);
                }
            });
        } else {
            checkboxes.forEach(cb => {
                cb.checked = false;
                cb.closest('.file-item').classList.remove('selected');
            });
            this.selectedNodes.clear();
        }
        this.updateBulkActions();
    }
    
    updateBulkActions() {
        if (this.selectedNodes.size > 0) {
            this.bulkActionsBar.classList.remove('hidden');
            this.bulkCountText.textContent = this.selectedNodes.size;
        } else {
            this.bulkActionsBar.classList.add('hidden');
        }
    }
    
    clearSelection() {
        this.selectedNodes.clear();
        this.selectAllCheckbox.checked = false;
        
        const checkboxes = this.nodeList.querySelectorAll('.custom-checkbox input');
        checkboxes.forEach(cb => {
            cb.checked = false;
            cb.closest('.file-item').classList.remove('selected');
        });
        
        this.updateBulkActions();
    }

    // --- Settings ---
    async loadSettings() {
        try {
            const res = await this.authFetch('/api/settings');
            const data = await res.json();
            if (data.success) {
                this.settings = data.settings;
                if (this.settings.maxUploadSize) {
                    this.settingMaxUpload.value = Math.floor(this.settings.maxUploadSize / (1024 * 1024));
                }
                
                if (data.network) {
                    document.getElementById('setting-net-port').value = data.network.port || 3000;
                    document.getElementById('setting-net-host').value = data.network.host || '127.0.0.1';
                    document.getElementById('setting-net-proxy').checked = !!data.network.trustProxy;
                    
                    if (data.network.tls) {
                        const tlsEnabled = !!data.network.tls.enabled;
                        document.getElementById('setting-net-tls').checked = tlsEnabled;
                        document.getElementById('tls-settings-container').style.display = tlsEnabled ? 'flex' : 'none';
                        document.getElementById('setting-tls-cert').value = data.network.tls.certPath || '';
                        document.getElementById('setting-tls-key').value = data.network.tls.keyPath || '';
                    }
                }
            }
        } catch (e) {
            console.error("Failed to load settings:", e);
        }
    }
    
    async openSettingsModal() {
        if (!this.settings) return;
        const mbSize = Math.floor(this.settings.maxUploadSize / (1024 * 1024));
        this.settingMaxUpload.value = mbSize;
        
        try {
            const res = await this.authFetch('/api/sessions');
            const data = await res.json();
            if (data.success) {
                this.renderSessions(data.sessions);
            }
        } catch (e) {
            console.error("Failed to load sessions", e);
        }
        
        this.settingsModal.classList.remove('hidden');
    }
    
    renderSessions(sessions) {
        const container = document.getElementById('sessions-list');
        container.innerHTML = '';
        
        sessions.forEach(session => {
            const div = document.createElement('div');
            div.style.padding = '0.75rem';
            div.style.background = 'rgba(0, 0, 0, 0.2)';
            div.style.borderRadius = '0.5rem';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            div.style.border = session.isCurrent ? '1px solid var(--color-primary)' : '1px solid var(--color-border)';
            
            const info = document.createElement('div');
            info.innerHTML = `
                <div style="font-weight: 500; font-size: 0.9rem; color: var(--color-text-main);">
                    ${session.userAgent} ${session.isCurrent ? '<span style="color:var(--color-primary); font-size:0.75rem; margin-left:0.5rem;">(Current)</span>' : ''}
                </div>
                <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.25rem;">
                    IP: ${session.ip || 'Unknown'} • Created: ${new Date(session.createdAt || Date.now()).toLocaleDateString()}
                </div>
            `;
            
            const revokeBtn = document.createElement('button');
            revokeBtn.className = 'btn btn-danger btn-sm';
            revokeBtn.textContent = 'Revoke';
            revokeBtn.onclick = () => this.revokeSession(session.id);
            if (session.isCurrent) {
                revokeBtn.disabled = true;
                revokeBtn.style.opacity = '0.5';
                revokeBtn.style.cursor = 'not-allowed';
            }
            
            div.appendChild(info);
            div.appendChild(revokeBtn);
            container.appendChild(div);
        });
    }

    async revokeSession(token) {
        try {
            const res = await this.authFetch(`/api/sessions/${token}`, { method: 'DELETE' });
            if (res.ok) {
                this.showToast('Session revoked', 'success');
                this.openSettingsModal();
            }
        } catch (e) {
            this.showToast('Failed to revoke session', 'error');
        }
    }

    async revokeAllSessions() {
        try {
            const res = await this.authFetch(`/api/sessions`, { method: 'DELETE' });
            if (res.ok) {
                this.showToast('All other sessions revoked', 'success');
                this.openSettingsModal();
            }
        } catch (e) {
            this.showToast('Failed to revoke sessions', 'error');
        }
    }
    async handleChangePassword() {
        const currentPassword = document.getElementById('setting-current-password').value;
        const newPassword = document.getElementById('setting-new-password').value;
        const confirmPassword = document.getElementById('setting-confirm-password').value;
        const errorEl = document.getElementById('password-error');
        const successEl = document.getElementById('password-success');
        
        errorEl.classList.add('hidden');
        successEl.style.display = 'none';
        
        if (newPassword !== confirmPassword) {
            errorEl.textContent = 'New passwords do not match';
            errorEl.classList.remove('hidden');
            return;
        }
        
        try {
            const res = await this.authFetch('/api/settings/password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword })
            });
            const data = await res.json();
            
            if (res.ok && data.success) {
                successEl.style.display = 'block';
                document.getElementById('change-password-form').reset();
                setTimeout(() => { successEl.style.display = 'none'; }, 3000);
            } else {
                errorEl.textContent = data.error || 'Failed to update password';
                errorEl.classList.remove('hidden');
            }
        } catch (e) {
            errorEl.textContent = 'Server connection error';
            errorEl.classList.remove('hidden');
        }
    }
    
    async saveSettings() {
        const mbSize = parseInt(this.settingMaxUpload.value, 10);
        if (isNaN(mbSize) || mbSize < 1) {
            this.showToast('Invalid size. Must be >= 1 MB', 'error');
            return;
        }
        const bytes = mbSize * 1024 * 1024;
        
        try {
            const res = await this.authFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ maxUploadSize: bytes })
            });
            const data = await res.json();
            if (data.success) {
                this.settings = data.settings;
                this.showToast('General Settings saved successfully');
                this.closeModals();
            } else {
                this.showToast('Failed to save settings', 'error');
            }
        } catch (e) {
            this.showToast('Error saving settings', 'error');
        }
    }
    
    async saveNetworkSettings() {
        const port = parseInt(document.getElementById('setting-net-port').value, 10);
        const host = document.getElementById('setting-net-host').value;
        const trustProxy = document.getElementById('setting-net-proxy').checked;
        const tlsEnabled = document.getElementById('setting-net-tls').checked;
        const tlsCertPath = document.getElementById('setting-tls-cert').value;
        const tlsKeyPath = document.getElementById('setting-tls-key').value;
        
        if (tlsEnabled && (!tlsCertPath || !tlsKeyPath)) {
            this.showToast('Must provide TLS Cert and Key paths', 'error');
            return;
        }
        
        try {
            const res = await this.authFetch('/api/settings/network', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ port, host, trustProxy, tlsEnabled, tlsCertPath, tlsKeyPath })
            });
            const data = await res.json();
            if (data.success) {
                this.showToast('Network settings saved!');
                document.getElementById('btn-restart-server').style.display = 'inline-flex';
            } else {
                this.showToast('Failed to save network config', 'error');
            }
        } catch (e) {
            this.showToast('Error saving network settings', 'error');
        }
    }
    
    async triggerRestart() {
        this.showToast('Restarting server...', 'info');
        try {
            const res = await this.authFetch('/api/system/restart', { method: 'POST' });
            const data = await res.json();
            
            if (res.status === 409) {
                this.showToast(data.error || 'Transfers in progress. Wait and try again.', 'error');
                return;
            }
            
            if (data.success) {
                this.showToast('Server restarting. Reconnecting...', 'success');
                setTimeout(() => {
                    window.location.href = data.newUrl;
                }, 2000); // Give backend 2s to rebind
            } else {
                this.showToast('Restart failed: ' + (data.error || 'Unknown'), 'error');
            }
        } catch (e) {
            this.showToast('Server closed unexpectedly. If port changed, refresh manually.', 'warning');
        }
    }

    // --- Actions ---
    async submitNewFolder() {
        const name = this.newFolderName.value.trim();
        if (!name) return;
        
        try {
            const res = await this.authFetch('/api/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, parentId: this.currentFolderId })
            });
            if (res.ok) {
                this.showToast('Folder created');
                this.closeModals();
                this.loadNodes(this.currentFolderId);
            } else {
                this.showToast('Failed to create folder', 'error');
            }
        } catch (e) {
            this.showToast('Failed to create folder', 'error');
        }
    }

    async downloadFile(uuid, event) {
        if (event) event.stopPropagation();
        try {
            const res = await this.authFetch('/api/download-ticket', { method: 'POST' });
            const data = await res.json();
            if (data.ticket) {
                document.cookie = `download_ticket=${data.ticket}; path=/api/download/${uuid}; max-age=60; samesite=strict`;
                window.location.href = `/api/download/${uuid}`;
                this.showToast('Decrypting and downloading...', 'success');
            } else {
                this.showToast('Failed to get download ticket', 'error');
            }
        } catch (e) {
            this.showToast('Error preparing download', 'error');
        }
    }
    
    async downloadFolder(uuid, event) {
        if (event) event.stopPropagation();
        try {
            const res = await this.authFetch('/api/download-ticket', { method: 'POST' });
            const data = await res.json();
            if (data.ticket) {
                document.cookie = `download_ticket=${data.ticket}; path=/api/download-folder/${uuid}; max-age=60; samesite=strict`;
                window.location.href = `/api/download-folder/${uuid}`;
                this.showToast('Zipping and downloading folder...', 'success');
            } else {
                this.showToast('Failed to get download ticket', 'error');
            }
        } catch (e) {
            this.showToast('Error preparing zip', 'error');
        }
    }

    deleteNodePrompt(uuid, event) {
        if (event) event.stopPropagation();
        this.openConfirmModal('Are you sure you want to delete this? Folders will be deleted recursively.', async () => {
            try {
                const res = await this.authFetch(`/api/nodes/${uuid}`, { method: 'DELETE' });
                if (res.ok) {
                    this.showToast('Deleted successfully');
                    this.selectedNodes.delete(uuid);
                    this.loadNodes(this.currentFolderId);
                } else {
                    this.showToast('Failed to delete', 'error');
                }
            } catch (error) {
                this.showToast('Error deleting', 'error');
            }
        });
    }
    
    async downloadSelected() {
        if (this.selectedNodes.size === 0) return;
        
        if (this.selectedNodes.size === 1) {
            // Check if it's a folder or file to route correctly
            // But since we just have uuids here, easiest is to use the bulk download anyway
        }
        
        try {
            const res = await this.authFetch('/api/download-ticket', { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uuids: Array.from(this.selectedNodes) })
            });
            const data = await res.json();
            if (data.ticket) {
                document.cookie = `download_ticket=${data.ticket}; path=/api/download-multiple; max-age=60; samesite=strict`;
                window.location.href = `/api/download-multiple`;
                this.showToast(`Zipping and downloading ${this.selectedNodes.size} items...`, 'success');
                // Deselect after download
                this.selectedNodes.clear();
                this.loadNodes(this.currentFolderId);
            } else {
                this.showToast('Failed to get download ticket', 'error');
            }
        } catch (e) {
            this.showToast('Error preparing bulk download', 'error');
        }
    }
    
    deleteSelected() {
        if (this.selectedNodes.size === 0) return;
        
        this.openConfirmModal(`Are you sure you want to delete ${this.selectedNodes.size} items permanently?`, async () => {
            let successCount = 0;
            const uuids = Array.from(this.selectedNodes);
            
            // Delete sequentially to avoid overwhelming server, or Promise.all. 
            // Sequential is safer for the manifest logic.
            for (const uuid of uuids) {
                try {
                    const res = await this.authFetch(`/api/nodes/${uuid}`, { method: 'DELETE' });
                    if (res.ok) successCount++;
                } catch(e) {}
            }
            
            this.selectedNodes.clear();
            this.showToast(`Successfully deleted ${successCount} items`);
            this.loadNodes(this.currentFolderId);
        });
    }

    // --- Uploads ---
    async handleUploads(filesList) {
        if (!filesList || filesList.length === 0) return;
        
        let allFiles = Array.from(filesList);
        
        // Conflict Detection
        const conflicts = [];
        const cleanFiles = [];
        const existingFiles = Object.values(this.currentFolderNodes || {}).filter(n => n.type === 'file');
        
        allFiles.forEach(file => {
            const relativePath = file.webkitRelativePath || file._customRelativePath || '';
            if (relativePath === '' || relativePath === file.name) {
                const match = existingFiles.find(n => n.name === file.name);
                if (match) {
                    conflicts.push({ file, existingNode: match });
                } else {
                    cleanFiles.push(file);
                }
            } else {
                cleanFiles.push(file);
            }
        });
        
        let finalFilesToUpload = [...cleanFiles];
        
        // Process clean files first if there are conflicts
        if (conflicts.length > 0) {
            if (cleanFiles.length > 0) {
                // We'll upload clean files in the background while waiting for user input
                this.processUploadBatch(cleanFiles, false);
                finalFilesToUpload = []; // We handled them
            }
            
            const resolutions = await this.promptConflictResolution(conflicts);
            
            const resolvedFiles = [];
            for (let i = 0; i < conflicts.length; i++) {
                const c = conflicts[i];
                const res = resolutions[i];
                
                if (res === 'skip') {
                    // Do nothing
                } else if (res === 'keep') {
                    const extIndex = c.file.name.lastIndexOf('.');
                    const name = extIndex > 0 ? c.file.name.substring(0, extIndex) : c.file.name;
                    const ext = extIndex > 0 ? c.file.name.substring(extIndex) : '';
                    let newName = `${name} (1)${ext}`;
                    let counter = 1;
                    while (existingFiles.some(n => n.name === newName)) {
                        counter++;
                        newName = `${name} (${counter})${ext}`;
                    }
                    c.file._customName = newName;
                    resolvedFiles.push(c.file);
                } else if (res === 'replace') {
                    this.showToast(`Replacing ${c.file.name}...`);
                    try {
                        await this.authFetch(`/api/nodes/${c.existingNode.id}`, { method: 'DELETE' });
                    } catch(e) {}
                    resolvedFiles.push(c.file);
                }
            }
            
            if (resolvedFiles.length > 0) {
                finalFilesToUpload = finalFilesToUpload.concat(resolvedFiles);
            }
        }
        
        if (finalFilesToUpload.length > 0) {
            await this.processUploadBatch(finalFilesToUpload, true);
        } else if (cleanFiles.length === 0) {
            // Nothing to do
        }
    }
    
    async processUploadBatch(files, showSummaryAtEnd = true) {
        if (files.length === 0) return;
        
        this.uploadOverlay.classList.remove('hidden');
        this.uploadTitle.textContent = files.length > 1 ? `Encrypting ${files.length} items...` : 'Encrypting File...';
        this.uploadBar.style.width = '0%';
        this.uploadPercentage.textContent = '0%';
        
        let completed = 0;
        const successfulFiles = [];
        const failedFiles = [];
        
        const updateProgress = () => {
            const pct = Math.round((completed / files.length) * 100);
            this.uploadBar.style.width = pct + '%';
            this.uploadPercentage.textContent = pct + '%';
            this.uploadProgressText.textContent = `${completed} / ${files.length} files`;
        };
        
        updateProgress();
        
        const concurrency = 3;
        let index = 0;
        
        const worker = async () => {
            while (index < files.length) {
                const i = index++;
                const file = files[i];
                
                if (this.settings && this.settings.maxUploadSize && file.size > this.settings.maxUploadSize) {
                    failedFiles.push({ name: file.name, error: 'File too large' });
                    completed++;
                    updateProgress();
                    continue;
                }
                
                this.uploadFilename.textContent = file._customName || file.name;
                const relativePath = file.webkitRelativePath || file._customRelativePath || '';
                
                try {
                    await this.uploadSingleFile(file, relativePath);
                    successfulFiles.push({ name: file._customName || file.name });
                } catch (err) {
                    failedFiles.push({ name: file._customName || file.name, error: err.message });
                }
                
                completed++;
                updateProgress();
            }
        };
        
        const workers = [];
        for (let i = 0; i < Math.min(concurrency, files.length); i++) workers.push(worker());
        await Promise.all(workers);
        
        if (showSummaryAtEnd) {
            setTimeout(() => {
                this.uploadOverlay.classList.add('hidden');
                this.showSummaryPanel(successfulFiles, failedFiles);
                this.loadNodes(this.currentFolderId);
            }, 500);
        }
        
        // Reset inputs
        this.fileUploadInput.value = '';
        this.folderUploadInput.value = '';
    }
    
    // --- Summary Panel ---
    showSummaryPanel(successfulFiles, failedFiles) {
        this.summarySuccessList.innerHTML = '';
        this.summaryErrorList.innerHTML = '';
        
        this.summarySuccessCount.textContent = `(${successfulFiles.length})`;
        this.summaryErrorCount.textContent = `(${failedFiles.length})`;
        
        successfulFiles.forEach(f => {
            const li = document.createElement('li');
            li.textContent = f.name;
            this.summarySuccessList.appendChild(li);
        });
        
        failedFiles.forEach(f => {
            const li = document.createElement('li');
            li.textContent = `${f.name} - ${f.error}`;
            li.title = `${f.name} - ${f.error}`;
            this.summaryErrorList.appendChild(li);
        });
        
        // Show panel and expand details
        this.summaryPanel.classList.remove('hidden');
        this.summaryDetails.classList.remove('hidden');
        this.summaryToggleIcon.classList.remove('ph-caret-down');
        this.summaryToggleIcon.classList.add('ph-caret-up');
    }
    
    toggleSummaryDetails() {
        if (this.summaryDetails.classList.contains('hidden')) {
            this.summaryDetails.classList.remove('hidden');
            this.summaryToggleIcon.classList.remove('ph-caret-down');
            this.summaryToggleIcon.classList.add('ph-caret-up');
        } else {
            this.summaryDetails.classList.add('hidden');
            this.summaryToggleIcon.classList.remove('ph-caret-up');
            this.summaryToggleIcon.classList.add('ph-caret-down');
        }
    }
    
    closeSummary() {
        this.summaryPanel.classList.add('hidden');
    }

    promptConflictResolution(conflicts) {
        return new Promise((resolve) => {
            this.conflictMessage.textContent = `${conflicts.length} file(s) have names that already exist in this folder.`;
            this.conflictListContainer.innerHTML = '';
            
            const selects = [];
            
            conflicts.forEach((c, i) => {
                const item = document.createElement('div');
                item.className = 'conflict-item';
                
                const nameSpan = document.createElement('span');
                nameSpan.className = 'conflict-filename';
                nameSpan.textContent = c.file.name;
                nameSpan.title = c.file.name;
                
                const btnGroup = document.createElement('div');
                btnGroup.className = 'conflict-btn-group';
                btnGroup.style.display = 'flex';
                btnGroup.style.gap = '0.25rem';
                
                const btnSkip = document.createElement('button');
                btnSkip.className = 'btn btn-secondary btn-sm active-conflict-btn';
                btnSkip.textContent = 'Skip';
                
                const btnKeep = document.createElement('button');
                btnKeep.className = 'btn btn-secondary btn-sm';
                btnKeep.textContent = 'Keep Both';
                
                const btnReplace = document.createElement('button');
                btnReplace.className = 'btn btn-secondary btn-sm';
                btnReplace.textContent = 'Replace';
                
                const state = { value: 'skip' };
                selects.push(state);

                const updateBtns = (val) => {
                    state.value = val;
                    btnSkip.classList.toggle('active-conflict-btn', val === 'skip');
                    btnKeep.classList.toggle('active-conflict-btn', val === 'keep');
                    btnReplace.classList.toggle('active-conflict-btn', val === 'replace');
                };

                state.updateUI = updateBtns;

                btnSkip.onclick = () => updateBtns('skip');
                btnKeep.onclick = () => updateBtns('keep');
                btnReplace.onclick = () => updateBtns('replace');
                
                btnGroup.appendChild(btnSkip);
                btnGroup.appendChild(btnKeep);
                btnGroup.appendChild(btnReplace);
                
                item.appendChild(nameSpan);
                item.appendChild(btnGroup);
                this.conflictListContainer.appendChild(item);
            });
            
            this.conflictModal.classList.remove('hidden');
            
            const handleApply = () => {
                this.conflictModal.classList.add('hidden');
                cleanup();
                const results = selects.map(s => s.value);
                resolve(results);
            };
            
            const handleGlobal = (val) => {
                selects.forEach(s => s.updateUI(val));
            };
            
            const cleanup = () => {
                this.conflictSkipBtn.onclick = null;
                this.conflictKeepBtn.onclick = null;
                this.conflictReplaceBtn.onclick = null;
                this.conflictApplyBtn.onclick = null;
                this.pendingConflictResolution = null;
            };
            
            this.pendingConflictResolution = () => { cleanup(); resolve(conflicts.map(() => 'skip')); };
            this.conflictSkipBtn.onclick = () => handleGlobal('skip');
            this.conflictKeepBtn.onclick = () => handleGlobal('keep');
            this.conflictReplaceBtn.onclick = () => handleGlobal('replace');
            this.conflictApplyBtn.onclick = handleApply;
        });
    }

    uploadSingleFile(file, relativePath) {
        return new Promise((resolve, reject) => {
            if (!this.token) return reject(new Error('Unauthenticated'));
            
            const formData = new FormData();
            formData.append('parentId', this.currentFolderId);
            formData.append('relativePath', relativePath);
            formData.append('file', file);
            if (file._customName) {
                formData.append('originalname', file._customName);
            }
            
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/upload', true);
            xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);
            
            // Remove individual file progress to prevent racing progress bars
            // xhr.upload.onprogress = (e) => { ... };
            
            xhr.onload = () => {
                if (xhr.status === 200) {
                    resolve();
                } else {
                    let errMsg = 'Upload failed';
                    try {
                        const data = JSON.parse(xhr.responseText);
                        if (data.error) errMsg = data.error;
                    } catch (e) {
                        errMsg = xhr.statusText || 'Upload failed';
                    }
                    reject(new Error(errMsg));
                }
            };
            
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.send(formData);
        });
    }

    async handleDrop(e) {
        this.dropzone.classList.add('hidden');
        
        const items = e.dataTransfer.items;
        if (!items) return;
        
        const filesToUpload = [];
        
        this.uploadOverlay.classList.remove('hidden');
        this.uploadTitle.textContent = "Scanning files...";
        this.uploadFilename.textContent = "Reading directory structure...";
        this.uploadBar.style.width = '100%';
        this.uploadPercentage.textContent = '';
        this.uploadProgressText.textContent = '';
        
        const scanEntry = (entry, path = '') => {
            return new Promise((resolve) => {
                if (entry.isFile) {
                    entry.file(f => {
                        f._customRelativePath = path ? `${path}/${f.name}` : f.name;
                        filesToUpload.push(f);
                        resolve();
                    });
                } else if (entry.isDirectory) {
                    const dirReader = entry.createReader();
                    dirReader.readEntries(async (entries) => {
                        const newPath = path ? `${path}/${entry.name}` : entry.name;
                        const promises = [];
                        for (let i = 0; i < entries.length; i++) {
                            promises.push(scanEntry(entries[i], newPath));
                        }
                        await Promise.all(promises);
                        resolve();
                    });
                } else {
                    resolve();
                }
            });
        };
        
        const promises = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry();
                if (entry) promises.push(scanEntry(entry));
            }
        }
        
        await Promise.all(promises);
        
        if (filesToUpload.length > 0) {
            await this.handleUploads(filesToUpload);
        } else {
            this.uploadOverlay.classList.add('hidden');
        }
    }

    toggleDropdown(id, event) {
        event.stopPropagation();
        const el = document.getElementById(id);
        const isHidden = el.classList.contains('hidden');
        document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.add('hidden'));
        if (isHidden) el.classList.remove('hidden');
    }
}

// Global click listener to close dropdowns
document.addEventListener('click', () => {
    document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.add('hidden'));
});

// Initialize App
window.app = new CryptVaultApp();
