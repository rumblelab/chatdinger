// Service worker for handling audio and selector management
class ClaudeExtensionBackground {
    constructor() {
      // For testing: Use local file or temporary hosting
      this.DEVELOPMENT_MODE = true; // Set to false for production
      this.SELECTORS_URL = this.DEVELOPMENT_MODE 
        ? chrome.runtime.getURL('selectors.json') // Local file for testing
        : 'https://raw.githubusercontent.com/claude-sound-extension/selectors/main/selectors.json';
      
      // Audio file URLs - you can use S3, CDN, or bundle with extension
      this.AUDIO_BASE_URL = this.DEVELOPMENT_MODE
        ? chrome.runtime.getURL('sounds/') // Local sounds folder for testing
        : 'https://your-s3-bucket.s3.amazonaws.com/claude-extension/sounds/'; // S3 bucket for production
      
      this.REPO_URL = 'https://github.com/claude-sound-extension/selectors';
      this.ISSUES_URL = 'https://github.com/claude-sound-extension/selectors/issues';
      this.FALLBACK_SELECTORS = {
        version: "1.0",
        lastUpdated: "2025-05-23",
        selectors: {
          generation: {
            stopButton: [
              '[data-testid="stop-button"]',
              'button[aria-label*="Stop"]',
              'button:has(svg[data-icon="stop"])',
              '[data-testid="stop-generation-button"]'
            ],
            loading: [
              '[data-testid="loading"]',
              '.loading',
              '[class*="loading"]',
              '[class*="generating"]',
              '[data-testid="message-loading"]'
            ]
          },
          error: [
            '[data-testid="error"]',
            '.error',
            '[class*="error"]',
            '[role="alert"]',
            '.text-red-500',
            '.text-red-600',
            '.text-red-700',
            '[data-testid="error-message"]'
          ]
        }
      };
      
      this.audioContext = null;
      this.offscreenDoc = null;
      this.init();
    }
  
    async init() {
      console.log('Claude Sound Extension background initialized');
      
      // Set up listeners
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        this.handleMessage(request, sender, sendResponse);
        return true; // Keep message channel open for async response
      });
  
      chrome.runtime.onInstalled.addListener(() => {
        this.updateSelectors();
      });
  
      // Update selectors periodically (every 6 hours)
      chrome.runtime.onStartup.addListener(() => {
        this.updateSelectors();
      });
  
      // Set up periodic selector updates
      this.setupPeriodicUpdates();
    }
  
    async handleMessage(request, sender, sendResponse) {
      try {
        switch (request.action) {
          case 'playCompletionSound':
            await this.playCompletionSound();
            sendResponse({ success: true });
            break;
          
          case 'playErrorSound':
            await this.playErrorSound();
            sendResponse({ success: true });
            break;
          
          case 'getSelectors':
            const selectors = await this.getSelectors();
            sendResponse({ selectors });
            break;
          
          case 'setVolume':
            await chrome.storage.local.set({ volume: request.volume });
            sendResponse({ success: true });
            break;
          
          case 'getVolume':
            const stored = await chrome.storage.local.get({ volume: 0.7 }); // Default 70%
            sendResponse({ volume: stored.volume });
            break;
          
          case 'reportIssue':
            // Help users report selector issues
            const issueData = {
              title: `Selector Issue: ${request.issue}`,
              body: `**Issue:** ${request.issue}\n**URL:** ${request.url}\n**User Agent:** ${request.userAgent}\n**Timestamp:** ${new Date().toISOString()}\n\n**Current Selectors Version:** ${(await this.getSelectors()).version}\n\n**Steps to Reproduce:**\n1. Go to ${request.url}\n2. ${request.issue}\n\n**Expected:** Sound should play\n**Actual:** No sound or wrong detection`
            };
            sendResponse({ issueData, issuesUrl: this.ISSUES_URL });
            break;
          
          default:
            sendResponse({ error: 'Unknown action' });
        }
      } catch (error) {
        console.error('Background script error:', error);
        sendResponse({ error: error.message });
      }
    }
  
    async setupOffscreenDocument() {
      if (this.offscreenDoc) return;
      
      try {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['AUDIO_PLAYBACK'],
          justification: 'Play notification sounds for Claude completion/errors'
        });
        this.offscreenDoc = true;
      } catch (error) {
        console.error('Could not create offscreen document:', error);
      }
    }
  
    async playCompletionSound() {
      await this.setupOffscreenDocument();
      
      try {
        await chrome.runtime.sendMessage({
          action: 'playAudio',
          type: 'completion',
          audioUrl: `${this.AUDIO_BASE_URL}completion.mp3`
        });
      } catch (error) {
        console.error('Error playing completion sound:', error);
      }
    }
  
    async playErrorSound() {
      await this.setupOffscreenDocument();
      
      try {
        await chrome.runtime.sendMessage({
          action: 'playAudio',
          type: 'error',
          audioUrl: `${this.AUDIO_BASE_URL}error.mp3`
        });
      } catch (error) {
        console.error('Error playing error sound:', error);
      }
    }
  
    async updateSelectors() {
      try {
        console.log('Fetching latest selectors...');
        
        let selectorData;
        if (this.DEVELOPMENT_MODE) {
          // Load local selectors.json for testing
          const response = await fetch(chrome.runtime.getURL('selectors.json'));
          if (response.ok) {
            selectorData = await response.json();
          } else {
            throw new Error('Local selectors.json not found');
          }
        } else {
          // Load from GitHub in production
          const response = await fetch(this.SELECTORS_URL);
          if (response.ok) {
            selectorData = await response.json();
          } else {
            throw new Error(`HTTP ${response.status}`);
          }
        }
        
        // Validate the data structure
        if (this.validateSelectorData(selectorData)) {
          await chrome.storage.local.set({ 
            selectors: selectorData,
            lastSelectorUpdate: Date.now()
          });
          console.log(`Selectors updated to version ${selectorData.version}`);
          return selectorData;
        } else {
          throw new Error('Invalid selector data structure');
        }
      } catch (error) {
        console.warn('Failed to fetch selectors, using fallback:', error);
        
        // Store fallback selectors if none exist
        const stored = await chrome.storage.local.get(['selectors']);
        if (!stored.selectors) {
          await chrome.storage.local.set({ 
            selectors: this.FALLBACK_SELECTORS,
            lastSelectorUpdate: Date.now()
          });
        }
        return stored.selectors || this.FALLBACK_SELECTORS;
      }
    }
  
    validateSelectorData(data) {
      return data && 
             data.version &&
             data.selectors &&
             data.selectors.generation &&
             data.selectors.error &&
             Array.isArray(data.selectors.generation.stopButton) &&
             Array.isArray(data.selectors.generation.loading) &&
             Array.isArray(data.selectors.error);
    }
  
    async getSelectors() {
      const stored = await chrome.storage.local.get(['selectors', 'lastSelectorUpdate']);
      
      // Check if selectors are older than 24 hours
      const twentyFourHours = 24 * 60 * 60 * 1000;
      if (!stored.selectors || 
          !stored.lastSelectorUpdate || 
          (Date.now() - stored.lastSelectorUpdate) > twentyFourHours) {
        return await this.updateSelectors();
      }
      
      return stored.selectors;
    }
  
    setupPeriodicUpdates() {
      // Update selectors every 6 hours
      setInterval(() => {
        this.updateSelectors();
      }, 6 * 60 * 60 * 1000);
    }
  }
  
  // Initialize the background service
  new ClaudeExtensionBackground();