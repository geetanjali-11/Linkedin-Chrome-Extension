document.addEventListener('DOMContentLoaded', () => {
    const sheetIdInput = document.getElementById('sheetId');
    const inviteCapInput = document.getElementById('inviteCap');
    const batchSizeInput = document.getElementById('batchSize');
    const cooldownTimeInput = document.getElementById('cooldownTime');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const statusLog = document.getElementById('statusLog');
    const progressContainer = document.getElementById('progressContainer');
    const progressLabel = document.getElementById('progressLabel');
    const progressBarFill = document.getElementById('progressBarFill');
    const cooldownTimer = document.getElementById('cooldownTimer');
    const timerText = document.getElementById('timerText');

    // Load saved settings
    chrome.storage.local.get(['sheetId', 'inviteCap', 'batchSize', 'cooldownTime', 'isAutomationRunning'], (data) => {
        if (data.sheetId) sheetIdInput.value = data.sheetId;
        if (data.inviteCap) inviteCapInput.value = data.inviteCap;
        if (data.batchSize) batchSizeInput.value = data.batchSize;
        if (data.cooldownTime) cooldownTimeInput.value = data.cooldownTime;
        
        if (data.isAutomationRunning) {
            setRunningState(true);
        }
    });

    startBtn.addEventListener('click', () => {
        const settings = {
            sheetId: sheetIdInput.value.trim(),
            inviteCap: parseInt(inviteCapInput.value),
            batchSize: parseInt(batchSizeInput.value),
            cooldownTime: parseInt(cooldownTimeInput.value)
        };

        if (!settings.sheetId) {
            log('Error: Sheet ID is required', 'error');
            return;
        }

        chrome.storage.local.set({ ...settings, isAutomationRunning: true }, () => {
            chrome.runtime.sendMessage({ action: 'startAutomation', settings });
            setRunningState(true);
            log('Automation started...', 'info');
        });
    });

    stopBtn.addEventListener('click', () => {
        chrome.storage.local.set({ isAutomationRunning: false }, () => {
            chrome.runtime.sendMessage({ action: 'stopAutomation' });
            setRunningState(false);
            log('Automation stopped manually.', 'info');
        });
    });

    function setRunningState(isRunning) {
        startBtn.disabled = isRunning;
        stopBtn.disabled = !isRunning;
        sheetIdInput.disabled = isRunning;
        inviteCapInput.disabled = isRunning;
        batchSizeInput.disabled = isRunning;
        cooldownTimeInput.disabled = isRunning;
    }

    function log(message, type = 'info') {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        
        const placeholder = statusLog.querySelector('.placeholder');
        if (placeholder) placeholder.remove();

        statusLog.appendChild(entry);
        statusLog.scrollTop = statusLog.scrollHeight;
    }

    // Listen for updates from background
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'log') {
            log(message.text, message.logType);
        } else if (message.action === 'updateProgress') {
            progressContainer.classList.remove('hidden');
            progressLabel.textContent = `Progress: ${message.current} / ${message.total}`;
            const percent = (message.current / message.total) * 100;
            progressBarFill.style.width = `${percent}%`;
        } else if (message.action === 'cooldownUpdate') {
            if (message.remaining > 0) {
                cooldownTimer.classList.remove('hidden');
                const mins = Math.floor(message.remaining / 60);
                const secs = message.remaining % 60;
                timerText.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            } else {
                cooldownTimer.classList.add('hidden');
            }
        } else if (message.action === 'automationFinished') {
            setRunningState(false);
            log('Automation session finished.', 'success');
        }
    });
});
