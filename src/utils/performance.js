// Performance monitoring utility
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.startTimes = new Map();
  }

  startTimer(name) {
    this.startTimes.set(name, performance.now());
  }

  endTimer(name) {
    const startTime = this.startTimes.get(name);
    if (startTime) {
      const duration = performance.now() - startTime;
      this.metrics.set(name, duration);
      this.startTimes.delete(name);
      
      // Log performance metrics for debugging
      if (duration > 100) { // Only log slow operations
        console.warn(`⚠️ Performance: ${name} took ${duration.toFixed(2)}ms`);
      }
      
      return duration;
    }
    return 0;
  }

  getMetrics() {
    return Object.fromEntries(this.metrics);
  }

  clearMetrics() {
    this.metrics.clear();
    this.startTimes.clear();
  }

  // Monitor memory usage
  getMemoryUsage() {
    if (performance.memory) {
      return {
        used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
        total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
        limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)
      };
    }
    return null;
  }

  // Check if we're approaching memory limits
  isMemoryUsageHigh() {
    const memory = this.getMemoryUsage();
    if (memory) {
      const usagePercent = (memory.used / memory.limit) * 100;
      return usagePercent > 80; // Warning at 80% usage
    }
    return false;
  }
}

// Create a singleton instance
const performanceMonitor = new PerformanceMonitor();

export default performanceMonitor;

// Performance optimization helpers
export const optimizeForLargeDataset = (data, threshold = 1000) => {
  if (data.length > threshold) {
    console.warn(`⚠️ Large dataset detected (${data.length} items). Consider implementing pagination or virtualization.`);
    return true;
  }
  return false;
};

export const batchProcess = (items, batchSize = 50, processor) => {
  return new Promise((resolve) => {
    const results = [];
    let currentIndex = 0;

    const processBatch = () => {
      const batch = items.slice(currentIndex, currentIndex + batchSize);
      
      if (batch.length === 0) {
        resolve(results);
        return;
      }

      // Process the current batch
      batch.forEach(item => {
        const result = processor(item);
        if (result !== undefined) {
          results.push(result);
        }
      });

      currentIndex += batchSize;

      // Schedule next batch
      requestAnimationFrame(processBatch);
    };

    processBatch();
  });
};

export const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}; 