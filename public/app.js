class CryptVaultApp {
    constructor() {
        // Core State
        this.currentFolderId = 'root';
        this.token = sessionStorage.getItem('token');
        this.selectedNodes = new Set();
        
        // UI Elements
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
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.checkAuth();
    }

    bindEvents() {
        this.loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });
        
        this.logoutBtn.addEventListener('click', () => this.handleLogout());
        
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
        this.newFolderModal.classList.add('hidden');
        this.confirmModal.classList.add('hidden');
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
        if (view === 'dashboard') {
            this.loginView.classList.remove('active-view');
            setTimeout(() => {
                this.loginView.classList.add('hidden');
                this.dashboardView.classList.remove('hidden');
                // trigger reflow
                void this.dashboardView.offsetWidth;
                this.dashboardView.classList.add('active-view');
            }, 400); // Wait for transition
            this.loadNodes(this.currentFolderId);
        } else {
            this.dashboardView.classList.remove('active-view');
            setTimeout(() => {
                this.dashboardView.classList.add('hidden');
                this.loginView.classList.remove('hidden');
                void this.loginView.offsetWidth;
                this.loginView.classList.add('active-view');
            }, 400);
        }
    }

    async checkAuth() {
        if (!this.token) return;
        try {
            const res = await this.authFetch('/api/check-auth');
            const data = await res.json();
            if (data.authenticated) {
                this.switchView('dashboard');
            } else {
                this.clearSession();
            }
        } catch (e) {
            this.clearSession();
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
                    <span class="item-title" title="${node.name}">${node.name}</span>
                </div>
                <div class="item-size text-right">${this.formatBytes(node.size)}</div>
                <div class="item-date text-right">${this.formatDate(node.uploadedAt || node.createdAt)}</div>
                <div class="item-actions text-center">
                    ${actionsHtml}
                </div>
            `;
            
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
                window.location.href = `/api/download/${uuid}?ticket=${data.ticket}`;
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
                window.location.href = `/api/download-folder/${uuid}?ticket=${data.ticket}`;
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
                window.location.href = `/api/download-multiple?ticket=${data.ticket}`;
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
    async handleUploads(files) {
        if (!files || files.length === 0) return;
        
        this.uploadOverlay.classList.remove('hidden');
        this.uploadTitle.textContent = files.length > 1 ? `Encrypting ${files.length} items...` : 'Encrypting File...';
        
        let successCount = 0;
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            this.uploadFilename.textContent = file.name;
            this.uploadProgressText.textContent = `${i + 1} / ${files.length} files`;
            this.uploadBar.style.width = '0%';
            this.uploadPercentage.textContent = '0%';
            
            const relativePath = file.webkitRelativePath || file._customRelativePath || '';
            
            try {
                await this.uploadSingleFile(file, relativePath);
                successCount++;
            } catch (err) {
                console.error('Upload failed for', file.name, err);
            }
        }
        
        setTimeout(() => {
            this.uploadOverlay.classList.add('hidden');
            this.showToast(`Successfully encrypted ${successCount} items`);
            this.loadNodes(this.currentFolderId);
        }, 500);
        
        // Reset inputs
        this.fileUploadInput.value = '';
        this.folderUploadInput.value = '';
    }

    uploadSingleFile(file, relativePath) {
        return new Promise((resolve, reject) => {
            if (!this.token) return reject(new Error('Unauthenticated'));
            
            const formData = new FormData();
            formData.append('parentId', this.currentFolderId);
            formData.append('relativePath', relativePath);
            formData.append('file', file);
            
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/upload', true);
            xhr.setRequestHeader('Authorization', `Bearer ${this.token}`);
            
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percentComplete = Math.round((e.loaded / e.total) * 100);
                    this.uploadBar.style.width = percentComplete + '%';
                    this.uploadPercentage.textContent = percentComplete + '%';
                }
            };
            
            xhr.onload = () => {
                if (xhr.status === 200) resolve();
                else reject(new Error(xhr.responseText));
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
}

// Initialize App
const app = new CryptVaultApp();
