const SheetsAPI = {
    async getAuthToken() {
        return new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, (token) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(token);
                }
            });
        });
    },

    async fetchRows(sheetId) {
        try {
            const token = await this.getAuthToken();
            const range = 'Sheet1!A:D'; // Adjust sheet name if necessary
            const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
            
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (!response.ok) throw new Error('Failed to fetch sheet data');
            
            const data = await response.json();
            return data.values || [];
        } catch (error) {
            console.error('SheetsAPI.fetchRows Error:', error);
            throw error;
        }
    },

    async updateRow(sheetId, rowIndex, status) {
        try {
            const token = await this.getAuthToken();
            // rowIndex is 0-indexed for the array, so it's rowIndex + 1 in sheet (1-indexed)
            // Column D is index 4 (A=1, B=2, C=3, D=4)
            const range = `Sheet1!D${rowIndex + 1}`; 
            const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=RAW`;
            
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    values: [[status]]
                })
            });
            
            if (!response.ok) throw new Error(`Failed to update sheet row ${rowIndex + 1}`);
            
            return await response.json();
        } catch (error) {
            console.error('SheetsAPI.updateRow Error:', error);
            throw error;
        }
    },

    async lockRow(sheetId, rowIndex) {
        return this.updateRow(sheetId, rowIndex, 'Pending');
    }
};

// Export if in a module environment, or just leave globally for service worker
if (typeof module !== 'undefined') {
    module.exports = SheetsAPI;
} else {
    self.SheetsAPI = SheetsAPI;
}
