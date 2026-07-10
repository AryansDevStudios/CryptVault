// Configure PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
}

class CryptVaultApp {
    constructor() {
        // Core State
        this.currentFolderId = 'root';
        this.token = sessionStorage.getItem('token');
        this.selectedNodes = new Set();
        
        // UI Elements - Views
        this.setupView = document.getElementById('setup-view');
        this.loginView = document.getElementById('login-view');
        this.dashboardView = document.getElementById('dashboard-view');
        
        // UI Elements - Forms & Inputs
        this.setupForm = document.getElementById('setup-form');
        this.setupPasswordInput = document.getElementById('setup-password');
        this.setupConfirmInput = document.getElementById('setup-confirm');
        this.setupError = document.getElementById('setup-error');
        
        this.loginForm = document.getElementById('login-form');
        this.passwordInput = document.getElementById('password');
        this.loginError = document.getElementById('login-error');
        
        // UI Elements - Dashboard
        this.nodeList = document.getElementById('node-list');
        this.emptyState = document.getElementById('empty-state');
        this.breadcrumbsContainer = document.getElementById('breadcrumbs');
        this.selectAllCheckbox = document.getElementById('select-all');
        this.bulkActionsBar = document.getElementById('floating-action-bar');
        this.bulkCountText = document.getElementById('bulk-count');
        
        // Upload Elements
        this.fileUploadInput = document.getElementById('file-upload');
        this.folderUploadInput = document.getElementById('folder-upload');
        this.dropzone = document.getElementById('dropzone');
        this.uploadOverlay = document.getElementById('upload-overlay');
        this.uploadTitle = document.getElementById('upload-title');
        this.uploadFilename = document.getElementById('upload-filename');
        this.uploadPercentage = document.getElementById('upload-percentage');
        this.uploadBar = document.getElementById('upload-bar');
        this.uploadProgressText = document.getElementById('upload-progress-text');
        
        // Modals & Panels
        this.toast = document.getElementById('toast');
        this.toastIcon = document.getElementById('toast-icon');
        this.toastMessage = document.getElementById('toast-message');
        
        this.newFolderModal = document.getElementById('new-folder-modal');
        this.newFolderName = document.getElementById('new-folder-name');
        
        this.confirmModal = document.getElementById('confirm-modal');
        this.confirmMessage = document.getElementById('confirm-message');
        this.pendingConfirmAction = null;
        
        this.settingsModal = document.getElementById('settings-modal');
        this.settingMaxUpload = document.getElementById('setting-max-upload');
        this.settings = null;
        
        this.summaryPanel = document.getElementById('upload-summary-panel');
        this.summaryDetails = document.getElementById('summary-details');
        
        this.conflictModal = document.getElementById('conflict-modal');
        this.conflictMessage = document.getElementById('conflict-message');
        this.conflictListContainer = document.getElementById('conflict-list-container');
        this.pendingConflictResolution = null;

        // Theme Setup
        this.initTheme();

        this.init();
    }

    initTheme() {
        const savedTheme = localStorage.getItem('theme-preference') || 'system';
        this.applyTheme(savedTheme);
        
        // Sync radio buttons
        const radios = document.querySelectorAll('input[name="theme-choice"]');
        radios.forEach(radio => {
            if (radio.value === savedTheme) radio.checked = true;
            radio.addEventListener('change', (e) => {
                const val = e.target.value;
                localStorage.setItem('theme-preference', val);
                this.applyTheme(val);
            });
        });

        // Listen for system changes if set to system
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (localStorage.getItem('theme-preference') === 'system' || !localStorage.getItem('theme-preference')) {
                this.applyTheme('system');
            }
        });
    }

    applyTheme(theme) {
        if (theme === 'system') {
            const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
    }

    init() {
        this.bindEvents();
        this.checkAuthStatus();
    }

    bindEvents() {
        // Auth events
        this.setupForm.addEventListener('submit', (e) => { e.preventDefault(); this.handleSetup(); });
        this.loginForm.addEventListener('submit', (e) => { e.preventDefault(); this.handleLogin(); });
        document.getElementById('logout-btn').addEventListener('click', () => this.handleLogout());
        
        // Settings / UI Modals Buttons
        document.getElementById('change-password-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleChangePassword();
        });
        
        const tlsCheckbox = document.getElementById('setting-net-tls');
        tlsCheckbox.addEventListener('change', (e) => {
            const container = document.getElementById('tls-settings-container');
            if (e.target.checked) {
                container.classList.remove('hidden');
            } else {
                container.classList.add('hidden');
            }
        });
        
        document.getElementById('network-settings-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveNetworkSettings();
        });
        
        document.getElementById('btn-restart-server').addEventListener('click', () => this.triggerRestart());
        document.getElementById('btn-save-settings').addEventListener('click', () => this.saveSettings());
        const resetBtn = document.getElementById('btn-reset-settings');
        if (resetBtn) resetBtn.addEventListener('click', () => this.resetSettings());
        
        // Dashboard Header Buttons
        document.getElementById('btn-new-menu').addEventListener('click', (e) => this.toggleDropdown('new-menu', e));
        document.getElementById('btn-new-folder').addEventListener('click', () => this.openNewFolderModal());
        document.getElementById('btn-upload-file').addEventListener('click', () => this.fileUploadInput.click());
        document.getElementById('btn-upload-folder').addEventListener('click', () => this.folderUploadInput.click());
        document.getElementById('btn-settings').addEventListener('click', () => this.openSettingsModal());
        document.getElementById('btn-view-audit').addEventListener('click', () => this.openAuditModal());
        document.getElementById('btn-close-audit').addEventListener('click', () => {
            document.getElementById('audit-modal').classList.add('hidden');
        });
        
        // Close modals on generic close buttons
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => this.closeModals());
        });

        // Modals Submit Action
        document.getElementById('btn-submit-folder').addEventListener('click', () => this.submitNewFolder());
        this.newFolderName.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.submitNewFolder();
        });
        document.getElementById('confirm-btn').addEventListener('click', () => {
            if (this.pendingConfirmAction) this.pendingConfirmAction();
            this.closeModals();
        });

        // File Inputs
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

        // Bulk Actions
        document.getElementById('btn-bulk-download').addEventListener('click', () => this.downloadSelected());
        document.getElementById('btn-bulk-delete').addEventListener('click', () => this.deleteSelected());
        document.getElementById('btn-bulk-clear').addEventListener('click', () => this.clearSelection());
        
        this.selectAllCheckbox.addEventListener('change', (e) => this.toggleSelectAll(e.target));

        // Summary Panel
        document.getElementById('btn-summary-toggle').addEventListener('click', () => this.toggleSummaryDetails());
        document.getElementById('btn-summary-close').addEventListener('click', () => this.summaryPanel.classList.add('hidden'));

        // Conflict Modal
        document.getElementById('conflict-skip-btn').addEventListener('click', () => this.handleConflictGlobal('skip'));
        document.getElementById('conflict-keep-btn').addEventListener('click', () => this.handleConflictGlobal('keep'));
        document.getElementById('conflict-replace-btn').addEventListener('click', () => this.handleConflictGlobal('replace'));
        document.getElementById('conflict-apply-btn').addEventListener('click', () => {
            if (this.conflictApplyCallback) this.conflictApplyCallback();
        });

        // Preview Pane
        document.getElementById('btn-close-preview').addEventListener('click', () => {
            this.closePreview();
        });

        // Mobile Long-Press Selection
        let pressTimer;
        this.nodeList.addEventListener('touchstart', (e) => {
            const fileItem = e.target.closest('.file-item');
            if (!fileItem) return;
            pressTimer = window.setTimeout(() => {
                document.body.classList.add('mobile-selection-active');
                const checkbox = fileItem.querySelector('input[type="checkbox"]');
                if (checkbox && !checkbox.checked) {
                    checkbox.checked = true;
                    this.toggleSelectNode(fileItem.dataset.id, checkbox);
                }
                if (navigator.vibrate) navigator.vibrate(50);
            }, 600);
        }, { passive: true });
        
        const clearTouchTimer = () => clearTimeout(pressTimer);
        this.nodeList.addEventListener('touchend', clearTouchTimer);
        this.nodeList.addEventListener('touchmove', clearTouchTimer);

        // Event Delegation for Node List (Solves UI uninteractability)
        this.nodeList.addEventListener('click', (e) => {
            const fileItem = e.target.closest('.file-item');
            if (!fileItem) return;

            const id = fileItem.dataset.id;
            const type = fileItem.dataset.type;

            // Handle Checkbox
            if (e.target.closest('.col-checkbox') || e.target.closest('.custom-checkbox')) {
                const checkbox = fileItem.querySelector('input[type="checkbox"]');
                // The native click on checkbox will toggle its state, so we just read it.
                // Wait, if they clicked the label, it auto toggles. If they clicked the container, we might need to manually toggle.
                // Best to let native label handle it and just respond to 'change' event instead of click.
                return;
            }

            // Handle Buttons
            if (e.target.closest('.action-btn.download')) {
                e.stopPropagation();
                if (type === 'folder') this.downloadFolder(id);
                else this.downloadFile(id);
                return;
            }

            if (e.target.closest('.action-btn.delete')) {
                e.stopPropagation();
                this.deleteNodePrompt(id);
                return;
            }

            // Clicking the row
            if (type === 'folder') {
                this.loadNodes(id);
            } else if (type === 'file') {
                this.previewFile(id);
            }
        });

        // Checkbox change delegation
        this.nodeList.addEventListener('change', (e) => {
            if (e.target.matches('.custom-checkbox input[type="checkbox"]')) {
                const fileItem = e.target.closest('.file-item');
                if (fileItem) {
                    const id = fileItem.dataset.id;
                    this.toggleSelectNode(id, e.target);
                }
            }
        });

        // Global click listener to close dropdowns
        document.addEventListener('click', () => {
            document.querySelectorAll('.dropdown-menu').forEach(m => m.classList.add('hidden'));
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
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
        this.newFolderName.value = '';
        this.pendingConfirmAction = null;
        if (this.pendingConflictResolution) {
            this.pendingConflictResolution('skip');
            this.pendingConflictResolution = null;
        }
    }
    
    openNewFolderModal() {
        this.newFolderModal.classList.remove('hidden');
        setTimeout(() => this.newFolderName.focus(), 100);
    }
    
    openConfirmModal(message, actionCallback) {
        this.confirmMessage.textContent = message;
        this.pendingConfirmAction = actionCallback;
        this.confirmModal.classList.remove('hidden');
    }

    // --- State & Auth ---
    switchView(view) {
        const views = {
            'setup': this.setupView,
            'login': this.loginView,
            'dashboard': this.dashboardView
        };
        
        Object.values(views).forEach(v => {
            if (v.classList.contains('active-view')) {
                v.classList.remove('active-view');
                setTimeout(() => v.classList.add('hidden'), 400);
            } else {
                v.classList.add('hidden');
            }
        });
        
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
            this.showToast('Server connection error', 'error');
        }
    }
    
    async resetSettings() {
        if (!confirm("Are you sure you want to reset all general settings back to factory defaults?")) return;
        try {
            const res = await this.authFetch('/api/settings/reset', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                this.settings = data.settings;
                this.showToast('Settings reset to defaults', 'success');
                this.closeModals();
            } else {
                this.showToast(data.error || 'Failed to reset settings', 'error');
            }
        } catch (e) {
            this.showToast('Server connection error', 'error');
        }
    }

    renderBreadcrumbs(breadcrumbs) {
        const render = (crumbs) => {
            this.breadcrumbsContainer.innerHTML = '';
            crumbs.forEach((crumb, index) => {
                const span = document.createElement('span');
                span.className = 'breadcrumb-item' + (index === crumbs.length - 1 ? ' active' : '');
                span.textContent = crumb.name;
                if(crumb.id) span.onclick = () => this.loadNodes(crumb.id);
                this.breadcrumbsContainer.appendChild(span);
                if (index < crumbs.length - 1) {
                    const sep = document.createElement('i');
                    sep.className = 'ph ph-caret-right text-muted mx-1';
                    this.breadcrumbsContainer.appendChild(sep);
                }
            });
        };
        render(breadcrumbs);
        // Truncate if overflowing
        if (this.breadcrumbsContainer.scrollWidth > this.breadcrumbsContainer.clientWidth && breadcrumbs.length > 2) {
            const truncated = [
                { name: '...', id: breadcrumbs[breadcrumbs.length - 2].id },
                breadcrumbs[breadcrumbs.length - 1]
            ];
            render(truncated);
        }
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
            
            // Set data attributes for event delegation
            el.dataset.id = node.id;
            el.dataset.type = node.type;
            
            const isFolder = node.type === 'folder';
            const iconHtml = isFolder 
                ? `<div class="item-icon icon-folder"><i class="ph-fill ph-folder"></i></div>`
                : `<div class="item-icon icon-file"><i class="ph ph-file-text"></i></div>`;
            
            const actionsHtml = isFolder ? `
                <button class="action-btn download" title="Download ZIP">
                    <i class="ph ph-file-zip"></i>
                </button>
                <button class="action-btn delete" title="Delete">
                    <i class="ph ph-trash"></i>
                </button>
            ` : `
                <button class="action-btn download" title="Download">
                    <i class="ph ph-download-simple"></i>
                </button>
                <button class="action-btn delete" title="Delete">
                    <i class="ph ph-trash"></i>
                </button>
            `;
            
            const isChecked = this.selectedNodes.has(node.id) ? 'checked' : '';
            
            el.innerHTML = `
                <div class="col-checkbox">
                    <label class="custom-checkbox">
                        <input type="checkbox" ${isChecked}>
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
            titleSpan.textContent = node.name; // Secure rendering (XSS Protection)
            titleSpan.setAttribute('title', node.name);
            
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
    
    toggleSelectAll(checkbox) {
        const checkboxes = this.nodeList.querySelectorAll('.custom-checkbox input');
        
        if (checkbox.checked) {
            checkboxes.forEach(cb => {
                if (!cb.checked) {
                    cb.checked = true;
                    const fileItem = cb.closest('.file-item');
                    fileItem.classList.add('selected');
                    this.selectedNodes.add(fileItem.dataset.id);
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
            document.body.classList.remove('mobile-selection-active');
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
                        const container = document.getElementById('tls-settings-container');
                        if (tlsEnabled) {
                            container.classList.remove('hidden');
                        } else {
                            container.classList.add('hidden');
                        }
                        
                        const statusIndicator = document.getElementById('tls-status-indicator');
                        if (data.network.tls.certPath && data.network.tls.keyPath) {
                            statusIndicator.textContent = '';
                            const tlsSpan = document.createElement('span');
                            tlsSpan.className = 'text-success';
                            const tlsIcon = document.createElement('i');
                            tlsIcon.className = 'ph-fill ph-check-circle';
                            tlsSpan.appendChild(tlsIcon);
                            tlsSpan.appendChild(document.createTextNode(' TLS Certificates are currently configured and valid.'));
                            statusIndicator.appendChild(tlsSpan);
                        } else {
                            statusIndicator.textContent = '';
                            const tlsSpan = document.createElement('span');
                            tlsSpan.className = 'text-muted';
                            const tlsIcon = document.createElement('i');
                            tlsIcon.className = 'ph ph-info';
                            tlsSpan.appendChild(tlsIcon);
                            tlsSpan.appendChild(document.createTextNode(' TLS is not configured.'));
                            statusIndicator.appendChild(tlsSpan);
                        }
                        
                        document.getElementById('setting-tls-cert').value = '';
                        document.getElementById('setting-tls-key').value = '';
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
        
        const parallelInput = document.getElementById('setting-parallel-uploads');
        if (parallelInput) parallelInput.value = this.settings.parallelUploads || 3;
        
        const timeoutInput = document.getElementById('setting-network-timeout');
        if (timeoutInput) timeoutInput.value = this.settings.networkTimeout || 0;
        
        const previewCheckbox = document.getElementById('setting-enable-preview');
        if (previewCheckbox) {
            previewCheckbox.checked = localStorage.getItem('enablePreview') === 'true';
        }
        
        this.settingsModal.classList.remove('hidden');
    }

    async openAuditModal() {
        try {
            const res = await this.apiCall('/api/settings/audit');
            const data = await res.json();
            const tbody = document.getElementById('audit-log-body');
            tbody.innerHTML = '';
            
            if (data.logs && data.logs.length > 0) {
                // Reverse to show newest first
                data.logs.reverse().forEach(log => {
                    const tr = document.createElement('tr');
                    tr.style.borderBottom = '1px solid var(--border-color)';
                    
                    const tdTime = document.createElement('td');
                    tdTime.style.padding = '8px';
                    tdTime.textContent = new Date(log.timestamp).toLocaleString();
                    
                    const tdAction = document.createElement('td');
                    tdAction.style.padding = '8px';
                    tdAction.textContent = log.action;
                    
                    const tdIp = document.createElement('td');
                    tdIp.style.padding = '8px';
                    tdIp.textContent = log.ip || 'unknown';
                    
                    const tdHash = document.createElement('td');
                    tdHash.style.padding = '8px';
                    tdHash.style.fontFamily = 'monospace';
                    tdHash.style.fontSize = '0.85em';
                    tdHash.textContent = log.hash ? log.hash.substring(0, 12) + '...' : 'N/A';
                    tdHash.title = `Hash: ${log.hash || 'N/A'}\nPrev: ${log.prevHash || 'N/A'}`;
                    
                    tr.appendChild(tdTime);
                    tr.appendChild(tdAction);
                    tr.appendChild(tdIp);
                    tr.appendChild(tdHash);
                    tbody.appendChild(tr);
                });
            } else {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = 4;
                td.style.padding = '8px';
                td.style.textAlign = 'center';
                td.style.fontStyle = 'italic';
                td.textContent = 'No audit logs found.';
                tr.appendChild(td);
                tbody.appendChild(tr);
            }
            
            document.getElementById('audit-modal').classList.remove('hidden');
        } catch (e) {
            this.showToast('Failed to load audit logs', 'error');
        }
    }

    async handleChangePassword() {
        const currentPassword = document.getElementById('setting-current-password').value;
        const newPassword = document.getElementById('setting-new-password').value;
        const confirmPassword = document.getElementById('setting-confirm-password').value;
        const errorEl = document.getElementById('password-error');
        const successEl = document.getElementById('password-success');
        
        errorEl.classList.add('hidden');
        successEl.classList.add('hidden');
        
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
                successEl.classList.remove('hidden');
                document.getElementById('change-password-form').reset();
                setTimeout(() => { successEl.classList.add('hidden'); }, 3000);
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
        
        const parallelInput = document.getElementById('setting-parallel-uploads');
        const parallelUploads = parallelInput ? parseInt(parallelInput.value, 10) : 3;
        
        const timeoutInput = document.getElementById('setting-network-timeout');
        const networkTimeout = timeoutInput ? parseInt(timeoutInput.value, 10) : 0;
        
        const previewCheckbox = document.getElementById('setting-enable-preview');
        if (previewCheckbox) {
            localStorage.setItem('enablePreview', previewCheckbox.checked);
        }
        
        try {
            const res = await this.authFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ maxUploadSize: bytes, parallelUploads, networkTimeout })
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
        const certInput = document.getElementById('setting-tls-cert');
        const keyInput = document.getElementById('setting-tls-key');
        
        const formData = new FormData();
        formData.append('port', port);
        formData.append('host', host);
        formData.append('trustProxy', trustProxy);
        formData.append('tlsEnabled', tlsEnabled);
        
        if (tlsEnabled && certInput.files.length > 0) {
            formData.append('tlsCertFile', certInput.files[0]);
        }
        if (tlsEnabled && keyInput.files.length > 0) {
            formData.append('tlsKeyFile', keyInput.files[0]);
        }
        
        try {
            const res = await this.authFetch('/api/settings/network', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (data.success) {
                this.showToast('Network settings saved!');
                document.getElementById('btn-restart-server').classList.remove('hidden');
                this.loadSettings();
            } else {
                this.showToast(data.error || 'Failed to save network config', 'error');
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
                    try {
                        const newUrl = new URL(data.newUrl, window.location.origin);
                        if (newUrl.origin === window.location.origin) {
                            window.location.href = newUrl.href;
                        } else {
                            this.showToast('Server returned an invalid redirect URL', 'error');
                        }
                    } catch (e) {
                        window.location.href = '/';
                    }
                }, 2000);
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

    closePreview() {
        document.getElementById('preview-pane').classList.add('hidden');
        document.getElementById('dashboard-view').classList.remove('preview-open');
        this.currentPreviewId = null;
        // Revoke any blob URLs to free memory
        if (this._currentBlobUrl) {
            URL.revokeObjectURL(this._currentBlobUrl);
            this._currentBlobUrl = null;
        }
    }

    async previewFile(uuid) {
        if (localStorage.getItem('enablePreview') !== 'true') {
            return;
        }

        const pane = document.getElementById('preview-pane');
        const title = document.getElementById('preview-title');
        const content = document.getElementById('preview-content');
        
        if (!pane.classList.contains('hidden') && this.currentPreviewId === uuid) {
            this.closePreview();
            return;
        }

        const node = this.currentFolderNodes[uuid];
        if (!node) return;

        const ext = node.name.split('.').pop().toLowerCase();
        const binaryExts = ['zip', 'rar', 'exe', 'dll', 'bin', 'iso', 'dmg', '7z', 'tar', 'gz', 'mp3', 'wav', 'flac'];
        if (binaryExts.includes(ext)) {
            this.closePreview();
            return;
        }

        this.currentPreviewId = uuid;
        document.getElementById('dashboard-view').classList.add('preview-open');
        pane.classList.remove('hidden');
        content.classList.remove('empty');
        
        title.innerText = node.name;
        title.title = node.name;
        
        if (node.size > 50 * 1024 * 1024) {
            content.textContent = '';
            const warnIcon = document.createElement('i');
            warnIcon.className = 'ph ph-file-dashed text-4xl mb-2 text-warning';
            const warnMsg = document.createElement('p');
            warnMsg.textContent = 'File is too large to preview (>50MB).';
            content.appendChild(warnIcon);
            content.appendChild(warnMsg);
            content.classList.add('empty');
            return;
        }
        
        content.textContent = '';
        const spinnerIcon = document.createElement('i');
        spinnerIcon.className = 'ph ph-spinner-gap text-4xl mb-2 text-primary';
        spinnerIcon.style.animation = 'spin 1s linear infinite';
        const loadingMsg = document.createElement('p');
        loadingMsg.textContent = 'Loading preview...';
        content.appendChild(spinnerIcon);
        content.appendChild(loadingMsg);
        content.classList.add('empty');

        try {
            const res = await this.authFetch('/api/download-ticket', { method: 'POST' });
            if (!res.ok) throw new Error('Failed to get ticket');
            const data = await res.json();
            
            const url = `/api/download/${uuid}?ticket=${data.ticket}`;
            const ext = node.name.split('.').pop().toLowerCase();
            
            // Image
            if (['jpg','jpeg','png','gif','webp','svg'].includes(ext)) {
                content.textContent = '';
                const img = document.createElement('img');
                img.src = url;
                img.alt = 'Preview';
                content.appendChild(img);
                content.classList.remove('empty');
                return;
            }
            
            // Video
            if (['mp4','webm','ogg'].includes(ext)) {
                content.textContent = '';
                const video = document.createElement('video');
                video.src = url;
                video.controls = true;
                video.autoplay = true;
                video.loop = true;
                content.appendChild(video);
                content.classList.remove('empty');
                return;
            }

            // Fetch Blob for PDF, MD, Text, Binary check
            const fileRes = await fetch(url);
            if (this.currentPreviewId !== uuid) return;
            if (!fileRes.ok) throw new Error('Download failed');
            
            const blob = await fileRes.blob();
            if (this.currentPreviewId !== uuid) return;
            // Revoke previous blob URL if any
            if (this._currentBlobUrl) {
                URL.revokeObjectURL(this._currentBlobUrl);
            }
            const blobUrl = URL.createObjectURL(blob);
            this._currentBlobUrl = blobUrl;
            
            // PDF
            if (ext === 'pdf') {
                content.innerHTML = '';
                content.classList.remove('empty');
                
                try {
                    const pdf = await pdfjsLib.getDocument(blobUrl).promise;
                    if (this.currentPreviewId !== uuid) return;
                    
                    for (let i = 1; i <= pdf.numPages; i++) {
                        if (this.currentPreviewId !== uuid) return;
                        const canvas = document.createElement('canvas');
                        canvas.className = 'w-full max-w-full rounded shadow-md pointer-events-none mb-4 bg-white';
                        content.appendChild(canvas);
                        
                        const page = await pdf.getPage(i);
                        if (this.currentPreviewId !== uuid) return;
                        
                        const viewport = page.getViewport({ scale: 1.5 });
                        canvas.width = viewport.width;
                        canvas.height = viewport.height;
                        
                        const ctx = canvas.getContext('2d');
                        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
                    }
                } catch (e) {
                    if (this.currentPreviewId !== uuid) return;
                    content.textContent = '';
                    const pdfErrIcon = document.createElement('i');
                    pdfErrIcon.className = 'ph ph-warning text-4xl mb-2 text-danger';
                    const pdfErrMsg = document.createElement('p');
                    pdfErrMsg.textContent = 'Failed to render PDF.';
                    content.appendChild(pdfErrIcon);
                    content.appendChild(pdfErrMsg);
                    content.classList.add('empty');
                }
                return;
            }

            // Markdown
            if (ext === 'md' || ext === 'markdown') {
                const text = await blob.text();
                if (this.currentPreviewId !== uuid) return;
                if (typeof DOMPurify === 'undefined') {
                    content.textContent = 'Preview unavailable: Security library not loaded.';
                    return;
                }
                const cleanHtml = DOMPurify.sanitize(marked.parse(text));
                content.innerHTML = `<div class="preview-markdown">${cleanHtml}</div>`;
                content.classList.remove('empty');
                return;
            }
            
            // Text or Binary fallback
            const slice = blob.slice(0, 4096);
            const textCheck = await slice.text();
            if (this.currentPreviewId !== uuid) return;
            
            if (textCheck.indexOf('\0') !== -1) {
                // Binary detected, quietly close preview
                this.closePreview();
                return;
            } else {
                // Text
                const fullText = await blob.text();
                if (this.currentPreviewId !== uuid) return;
                content.textContent = '';
                const preDiv = document.createElement('div');
                preDiv.className = 'preview-text';
                preDiv.textContent = fullText;
                content.appendChild(preDiv);
                content.classList.remove('empty');
            }

        } catch (error) {
            content.textContent = '';
            const errIcon = document.createElement('i');
            errIcon.className = 'ph ph-warning text-4xl mb-2 text-danger';
            const errMsg = document.createElement('p');
            errMsg.textContent = 'Failed to load preview.';
            content.appendChild(errIcon);
            content.appendChild(errMsg);
            content.classList.add('empty');
        }
    }

    async downloadFile(uuid) {
        try {
            const res = await this.authFetch('/api/download-ticket', { method: 'POST' });
            const data = await res.json();
            if (data.ticket) {
                window.location.href = `/api/download/${uuid}?ticket=${data.ticket}`;
                this.showToast('Decrypting and downloading...', 'success');
            } else {
                this.showToast('Failed to get download ticket', 'error');
            }
        } catch (e) {
            this.showToast('Error preparing download', 'error');
        }
    }
    
    async downloadFolder(uuid) {
        try {
            const res = await this.authFetch('/api/download-ticket', { method: 'POST' });
            const data = await res.json();
            if (data.ticket) {
                document.cookie = `download_ticket=${data.ticket}; path=/api/download-folder/${uuid}; max-age=60; samesite=strict; secure`;
                window.location.href = `/api/download-folder/${uuid}`;
                this.showToast('Zipping and downloading folder...', 'success');
            } else {
                this.showToast('Failed to get download ticket', 'error');
            }
        } catch (e) {
            this.showToast('Error preparing zip', 'error');
        }
    }

    deleteNodePrompt(uuid) {
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
        
        try {
            const res = await this.authFetch('/api/download-ticket', { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uuids: Array.from(this.selectedNodes) })
            });
            const data = await res.json();
            if (data.ticket) {
                document.cookie = `download_ticket=${data.ticket}; path=/api/download-multiple; max-age=60; samesite=strict; secure`;
                window.location.href = `/api/download-multiple`;
                this.showToast(`Zipping and downloading ${this.selectedNodes.size} items...`, 'success');
                this.clearSelection();
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
            
            for (const uuid of uuids) {
                try {
                    const res = await this.authFetch(`/api/nodes/${uuid}`, { method: 'DELETE' });
                    if (res.ok) successCount++;
                } catch(e) {}
            }
            
            this.clearSelection();
            this.showToast(`Successfully deleted ${successCount} items`);
            this.loadNodes(this.currentFolderId);
        });
    }

    // --- Uploads ---
    async handleUploads(filesList) {
        if (!filesList || filesList.length === 0) return;
        
        let allFiles = Array.from(filesList);
        
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
        
        if (conflicts.length > 0) {
            if (cleanFiles.length > 0) {
                this.processUploadBatch(cleanFiles, false);
                finalFilesToUpload = [];
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
        
        const concurrency = (this.settings && this.settings.parallelUploads > 0) ? this.settings.parallelUploads : 3;
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
        
        this.fileUploadInput.value = '';
        this.folderUploadInput.value = '';
    }
    
    // --- Summary Panel ---
    showSummaryPanel(successfulFiles, failedFiles) {
        const summarySuccessCount = document.getElementById('summary-success-count');
        const summaryErrorCount = document.getElementById('summary-error-count');
        const summarySuccessList = document.getElementById('summary-success-list');
        const summaryErrorList = document.getElementById('summary-error-list');
        const summaryToggleIcon = document.getElementById('summary-toggle-icon');

        summarySuccessList.textContent = '';
        summaryErrorList.textContent = '';
        
        summarySuccessCount.textContent = `(${successfulFiles.length})`;
        summaryErrorCount.textContent = `(${failedFiles.length})`;
        
        successfulFiles.forEach(f => {
            const li = document.createElement('li');
            li.textContent = f.name;
            summarySuccessList.appendChild(li);
        });
        
        failedFiles.forEach(f => {
            const li = document.createElement('li');
            li.textContent = `${f.name} - ${f.error}`;
            li.title = `${f.name} - ${f.error}`;
            summaryErrorList.appendChild(li);
        });
        
        this.summaryPanel.classList.remove('hidden');
        this.summaryDetails.classList.remove('hidden');
        summaryToggleIcon.classList.remove('ph-caret-down');
        summaryToggleIcon.classList.add('ph-caret-up');
    }
    
    toggleSummaryDetails() {
        const summaryToggleIcon = document.getElementById('summary-toggle-icon');
        if (this.summaryDetails.classList.contains('hidden')) {
            this.summaryDetails.classList.remove('hidden');
            summaryToggleIcon.classList.remove('ph-caret-down');
            summaryToggleIcon.classList.add('ph-caret-up');
        } else {
            this.summaryDetails.classList.add('hidden');
            summaryToggleIcon.classList.remove('ph-caret-up');
            summaryToggleIcon.classList.add('ph-caret-down');
        }
    }

    promptConflictResolution(conflicts) {
        return new Promise((resolve) => {
            this.conflictMessage.textContent = `${conflicts.length} file(s) have names that already exist in this folder.`;
            this.conflictListContainer.textContent = '';
            
            const selects = [];
            
            conflicts.forEach((c, i) => {
                const item = document.createElement('div');
                item.className = 'conflict-item';
                
                const nameSpan = document.createElement('span');
                nameSpan.className = 'conflict-filename';
                nameSpan.textContent = c.file.name;
                nameSpan.title = c.file.name;
                
                const btnGroup = document.createElement('div');
                btnGroup.className = 'flex gap-1';
                
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
            
            this.handleConflictGlobal = (val) => {
                selects.forEach(s => s.updateUI(val));
            };
            
            const cleanup = () => {
                this.conflictApplyCallback = null;
                this.pendingConflictResolution = null;
            };
            
            this.pendingConflictResolution = () => { cleanup(); resolve(conflicts.map(() => 'skip')); };
            this.conflictApplyCallback = handleApply;
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
            if (this.settings && this.settings.networkTimeout > 0) {
                xhr.timeout = this.settings.networkTimeout * 1000;
            }
            xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);
            
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
        const emptyDirsToUpload = [];
        
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
                        if (entries.length === 0) {
                            emptyDirsToUpload.push(newPath + '/');
                        } else {
                            const promises = [];
                            for (let i = 0; i < entries.length; i++) {
                                promises.push(scanEntry(entries[i], newPath));
                            }
                            await Promise.all(promises);
                        }
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

        // Upload empty directories first
        if (emptyDirsToUpload.length > 0) {
            this.uploadTitle.textContent = "Creating empty directories...";
            for (const dirPath of emptyDirsToUpload) {
                try {
                    await this.authFetch('/api/folders/path', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ baseParentId: this.currentFolderId, relativePath: dirPath })
                    });
                } catch(e) {}
            }
            if (filesToUpload.length === 0) {
                this.loadNodes(this.currentFolderId);
            }
        }
        
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

// Initialize App
window.app = new CryptVaultApp();
