class ClaudeSoundNotifier {
    constructor() {
      this.isGenerating = false;
      this.hasSeenGeneration = false;
      this.selectors = null;
      this.completionTimeout = null;
      this.errorTimeout = null;
      this.checkInterval = null;
      this.initializationComplete = false;
      this.pageLoadTime = Date.now();
      this.errorCount = 0; // Circuit breaker
      this.maxErrors = 10;
      this.isDestroyed = false;
      
      // Bind methods to prevent context issues
      this.checkGenerationState = this.checkGenerationState.bind(this);
      
      this.init();
    }
  
    async init() {
      try {
        console.log('Claude Sound Notifier initialized (conservative mode)');
        
        // Get selectors with timeout
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 5000)
        );
        
        const selectorPromise = chrome.runtime.sendMessage({ action: 'getSelectors' });
        
        const response = await Promise.race([selectorPromise, timeoutPromise]);
        this.selectors = response.selectors;
        console.log(`Using selectors version ${this.selectors.version}`);
        
        // Conservative initialization delay
        setTimeout(() => {
          if (!this.isDestroyed) {
            this.initializationComplete = true;
            this.startConservativeMonitoring();
          }
        }, 3000);
        
      } catch (error) {
        console.error('Failed to initialize Claude Sound Notifier:', error);
        // Use fallback selectors
        this.selectors = {
          version: "fallback",
          selectors: {
            generation: {
              stopButton: ['[data-testid="stop-button"]', 'button[aria-label*="Stop"]'],
              loading: ['[data-testid="loading"]', '.loading']
            },
            error: ['[role="alert"]', '.error']
          }
        };
        
        setTimeout(() => {
          if (!this.isDestroyed) {
            this.initializationComplete = true;
            this.startConservativeMonitoring();
          }
        }, 3000);
      }
    }
  
    safeQuerySelector(selector) {
      try {
        return document.querySelector(selector);
      } catch (e) {
        return null;
      }
    }
  
    safeQuerySelectorAll(selector) {
      try {
        return document.querySelectorAll(selector) || [];
      } catch (e) {
        return [];
      }
    }
  
    detectGenerationState() {
      if (!this.selectors || this.isDestroyed) return false;
      
      try {
        // Check only the most reliable selectors first
        const primaryStopSelectors = ['[data-testid="stop-button"]', 'button[aria-label*="Stop"]'];
        
        for (const selector of primaryStopSelectors) {
          const element = this.safeQuerySelector(selector);
          if (element && element.offsetParent !== null) {
            return true;
          }
        }
        
        // Check loading indicators (limited set)
        const primaryLoadingSelectors = ['[data-testid="loading"]', '.loading'];
        
        for (const selector of primaryLoadingSelectors) {
          const elements = this.safeQuerySelectorAll(selector);
          for (const element of elements) {
            if (element && element.offsetParent !== null) {
              return true;
            }
          }
        }
        
      } catch (error) {
        this.errorCount++;
        console.error('Error detecting generation state:', error);
        
        // Circuit breaker - stop if too many errors
        if (this.errorCount > this.maxErrors) {
          console.warn('Too many errors, disabling detection');
          this.destroy();
          return false;
        }
      }
      
      return false;
    }
  
    detectErrorState() {
      if (!this.selectors || this.isDestroyed) return false;
      
      try {
        // Only check for obvious error indicators
        const errorSelectors = ['[role="alert"]', '.error'];
        
        for (const selector of errorSelectors) {
          const elements = this.safeQuerySelectorAll(selector);
          for (const element of elements) {
            if (element && element.offsetParent !== null) {
              const text = (element.textContent || '').toLowerCase();
              if (text.includes('error') || text.includes('failed')) {
                return true;
              }
            }
          }
        }
        
      } catch (error) {
        this.errorCount++;
        console.error('Error detecting error state:', error);
      }
      
      return false;
    }
  
    async playCompletionSound() {
      if (this.isDestroyed) return;
      try {
        await chrome.runtime.sendMessage({ action: 'playCompletionSound' });
      } catch (error) {
        console.error('Failed to play completion sound:', error);
      }
    }
  
    async playErrorSound() {
      if (this.isDestroyed) return;
      try {
        await chrome.runtime.sendMessage({ action: 'playErrorSound' });
      } catch (error) {
        console.error('Failed to play error sound:', error);
      }
    }
  
    startConservativeMonitoring() {
      if (this.isDestroyed) return;
      
      try {
        // NO MutationObserver - just simple polling
        // Much less frequent checking to prevent overwhelming the browser
        this.checkInterval = setInterval(() => {
          if (!this.isDestroyed) {
            this.checkGenerationState();
          }
        }, 5000); // Check every 5 seconds instead of 2
  
        console.log('Started conservative monitoring (5-second intervals)');
        
      } catch (error) {
        console.error('Error starting monitoring:', error);
      }
    }
  
    checkGenerationState() {
      if (this.isDestroyed || !this.initializationComplete) return;
      
      try {
        // Extra protection against page load sounds
        if (Date.now() - this.pageLoadTime < 5000) return;
  
        const isCurrentlyGenerating = this.detectGenerationState();
        const hasError = this.detectErrorState();
  
        // Track generation start
        if (isCurrentlyGenerating && !this.hasSeenGeneration) {
          this.hasSeenGeneration = true;
          console.log('Claude generation started');
        }
  
        // Handle error state with longer timeout
        if (hasError && !this.errorTimeout) {
          this.errorTimeout = setTimeout(() => {
            if (!this.isDestroyed) {
              this.playErrorSound();
              console.log('Claude error detected - playing error sound');
            }
            this.errorTimeout = null;
          }, 1500); // Longer delay
        } else if (!hasError && this.errorTimeout) {
          clearTimeout(this.errorTimeout);
          this.errorTimeout = null;
        }
  
        // Handle completion with longer timeout
        if (this.isGenerating && !isCurrentlyGenerating && !hasError && this.hasSeenGeneration) {
          if (this.completionTimeout) {
            clearTimeout(this.completionTimeout);
          }
          
          this.completionTimeout = setTimeout(() => {
            if (!this.isDestroyed) {
              this.playCompletionSound();
              console.log('Claude generation completed - playing completion sound');
            }
            this.completionTimeout = null;
            this.hasSeenGeneration = false;
          }, 2000); // Longer delay to be sure
        }
  
        this.isGenerating = isCurrentlyGenerating;
        
      } catch (error) {
        this.errorCount++;
        console.error('Error in checkGenerationState:', error);
        
        // Circuit breaker
        if (this.errorCount > this.maxErrors) {
          console.warn('Circuit breaker triggered - stopping extension');
          this.destroy();
        }
      }
    }
  
    destroy() {
      console.log('Destroying Claude Sound Notifier');
      this.isDestroyed = true;
      
      if (this.checkInterval) {
        clearInterval(this.checkInterval);
        this.checkInterval = null;
      }
      
      if (this.completionTimeout) {
        clearTimeout(this.completionTimeout);
        this.completionTimeout = null;
      }
      
      if (this.errorTimeout) {
        clearTimeout(this.errorTimeout);
        this.errorTimeout = null;
      }
    }
  }
  
  // Initialize with maximum safety
  try {
    let claudeNotifier = null;
    
    // Wait for page to be fully ready
    const initializeExtension = () => {
      try {
        if (claudeNotifier) {
          claudeNotifier.destroy();
        }
        claudeNotifier = new ClaudeSoundNotifier();
      } catch (error) {
        console.error('Error initializing Claude Sound Notifier:', error);
      }
    };
  
    if (document.readyState === 'complete') {
      setTimeout(initializeExtension, 2000);
    } else {
      window.addEventListener('load', () => {
        setTimeout(initializeExtension, 2000);
      });
    }
  
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      if (claudeNotifier) {
        claudeNotifier.destroy();
      }
    });
  
    // Also cleanup on visibility change (tab switching)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && claudeNotifier) {
        claudeNotifier.destroy();
      }
    });
  
  } catch (error) {
    console.error('Critical error in Claude Sound Extension:', error);
  }
  