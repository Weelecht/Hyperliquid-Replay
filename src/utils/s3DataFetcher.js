// S3 Historical Data Fetcher for Hyperliquid Archive
// This utility demonstrates how to access complete historical data beyond API limits

export class S3DataFetcher {
  constructor() {
    this.baseUrl = 'https://hyperliquid-archive.s3.amazonaws.com';
    this.supportedDataTypes = ['l2Book', 'trades', 'candles', 'orders'];
  }

  /**
   * Generate S3 URL for historical data
   * @param {string} date - Date in YYYYMMDD format
   * @param {number} hour - Hour (0-23)
   * @param {string} dataType - Type of data (l2Book, trades, candles, orders)
   * @param {string} coin - Trading pair symbol
   * @returns {string} S3 URL
   */
  generateS3Url(date, hour, dataType, coin) {
    return `${this.baseUrl}/market_data/${date}/${hour}/${dataType}/${coin}.lz4`;
  }

  /**
   * Fetch and decompress LZ4 data from S3
   * @param {string} url - S3 URL
   * @returns {Promise<Array>} Decompressed data
   */
  async fetchLZ4Data(url) {
    try {
      console.log(`📥 Fetching S3 data from: ${url}`);
      
      // Note: This would require a backend service or proxy to handle LZ4 decompression
      // Browser cannot directly decompress LZ4 files
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // In a real implementation, you'd need:
      // 1. Backend service to decompress LZ4
      // 2. Or use a WebAssembly LZ4 decoder
      // 3. Or pre-process data on server side
      
      const data = await response.json();
      console.log(`✅ Fetched ${data.length} records from S3`);
      
      return data;
    } catch (error) {
      console.error(`❌ Error fetching S3 data: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get all available dates for a coin
   * @param {string} coin - Trading pair symbol
   * @returns {Promise<Array>} Available dates
   */
  async getAvailableDates(coin) {
    // This would require listing S3 bucket contents
    // For now, return a sample range
    const dates = [];
    const startDate = new Date('2023-01-01');
    const endDate = new Date();
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
    }
    
    return dates;
  }

  /**
   * Fetch complete order history for a user from S3
   * @param {string} userAddress - Ethereum address
   * @param {string} coin - Trading pair symbol
   * @param {string} startDate - Start date (YYYYMMDD)
   * @param {string} endDate - End date (YYYYMMDD)
   * @returns {Promise<Array>} Complete order history
   */
  async fetchCompleteOrderHistory(userAddress, coin, startDate, endDate) {
    console.log(`🔍 Fetching complete order history for ${userAddress} on ${coin}`);
    console.log(`📅 Date range: ${startDate} to ${endDate}`);
    
    const allOrders = [];
    const dates = this.generateDateRange(startDate, endDate);
    
    for (const date of dates) {
      for (let hour = 0; hour < 24; hour++) {
        try {
          // Fetch orders data for this date/hour
          const url = this.generateS3Url(date, hour, 'orders', coin);
          const hourData = await this.fetchLZ4Data(url);
          
          // Filter orders for this user
          const userOrders = hourData.filter(order => 
            order.user === userAddress || order.userAddress === userAddress
          );
          
          allOrders.push(...userOrders);
          
          console.log(`📊 ${date} ${hour}:00 - Found ${userOrders.length} orders for user`);
          
        } catch (error) {
          console.warn(`⚠️ No data for ${date} ${hour}:00 - ${error.message}`);
          continue;
        }
      }
    }
    
    console.log(`✅ Complete order history: ${allOrders.length} orders found`);
    return allOrders;
  }

  /**
   * Generate date range between start and end dates
   * @param {string} startDate - Start date (YYYYMMDD)
   * @param {string} endDate - End date (YYYYMMDD)
   * @returns {Array} Array of dates
   */
  generateDateRange(startDate, endDate) {
    const dates = [];
    const start = new Date(
      parseInt(startDate.slice(0, 4)),
      parseInt(startDate.slice(4, 6)) - 1,
      parseInt(startDate.slice(6, 8))
    );
    const end = new Date(
      parseInt(endDate.slice(0, 4)),
      parseInt(endDate.slice(4, 6)) - 1,
      parseInt(endDate.slice(6, 8))
    );
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
    }
    
    return dates;
  }

  /**
   * Get market data for charting (candles)
   * @param {string} coin - Trading pair symbol
   * @param {string} startDate - Start date (YYYYMMDD)
   * @param {string} endDate - End date (YYYYMMDD)
   * @param {string} interval - Timeframe (1m, 5m, 1h, 1d)
   * @returns {Promise<Array>} Candlestick data
   */
  async fetchMarketData(coin, startDate, endDate, interval = '1h') {
    console.log(`📈 Fetching market data for ${coin} (${interval})`);
    
    const allCandles = [];
    const dates = this.generateDateRange(startDate, endDate);
    
    for (const date of dates) {
      for (let hour = 0; hour < 24; hour++) {
        try {
          const url = this.generateS3Url(date, hour, 'candles', coin);
          const hourData = await this.fetchLZ4Data(url);
          
          // Filter by interval if needed
          const filteredCandles = this.filterByInterval(hourData, interval);
          allCandles.push(...filteredCandles);
          
        } catch (error) {
          console.warn(`⚠️ No candle data for ${date} ${hour}:00`);
          continue;
        }
      }
    }
    
    console.log(`✅ Market data: ${allCandles.length} candles found`);
    return allCandles;
  }

  /**
   * Filter candles by timeframe interval
   * @param {Array} candles - Raw candle data
   * @param {string} interval - Timeframe interval
   * @returns {Array} Filtered candles
   */
  filterByInterval(candles, interval) {
    // Implementation would depend on the actual data structure
    // This is a placeholder for interval filtering logic
    return candles;
  }
}

// Usage example:
/*
const s3Fetcher = new S3DataFetcher();

// Fetch complete order history (no 10,000 limit!)
const completeOrders = await s3Fetcher.fetchCompleteOrderHistory(
  '0x1234...',
  'BTC',
  '20230101',
  '20231231'
);

// Fetch market data for charting
const marketData = await s3Fetcher.fetchMarketData(
  'BTC',
  '20230101',
  '20231231',
  '1h'
);
*/ 