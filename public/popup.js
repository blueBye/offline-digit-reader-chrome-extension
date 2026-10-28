const button = document.querySelector('#select');
const status = document.querySelector('#status');
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab || !tab.id || !/^https?:\/\//.test(tab.url || '')) {
      throw new Error('Open a regular http(s) page first. Chrome internal pages cannot be inspected.');
    }
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['picker.js']});
    window.close();
  } catch (error) {
    status.textContent = error.message;
    status.className = 'status error';
    button.disabled = false;
  }
});
