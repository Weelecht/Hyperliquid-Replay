import React, { useState, useEffect, useMemo } from 'react';
import './OrderManager.css';

const OrderManager = ({ ethereumAddress, selectedToken, onTokenSelect, onTimeWindowUpdate, onOrdersUpdate, onTradesUpdate }) => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0, message: '' });
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  // HyperLiquid API endpoints
  const API_BASE_URL = 'https://api.hyperliquid.xyz';

  // Calculate time windows for each token based on order timestamps
  const calculateTimeWindows = (orders) => {
    const tokenTimeWindows = {};
    
    orders.forEach(order => {
      const token = order.token;
      const timestamp = new Date(order.timestamp).getTime();
      
      if (!tokenTimeWindows[token]) {
        tokenTimeWindows[token] = {
          earliest: timestamp,
          latest: timestamp
        };
      } else {
        tokenTimeWindows[token].earliest = Math.min(tokenTimeWindows[token].earliest, timestamp);
        tokenTimeWindows[token].latest = Math.max(tokenTimeWindows[token].latest, timestamp);
      }
    });
    
    // Add padding to the time windows (2 hours before earliest, 2 hours after latest)
    Object.keys(tokenTimeWindows).forEach(token => {
      const padding = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
      tokenTimeWindows[token].earliest -= padding;
      tokenTimeWindows[token].latest += padding;
    });
    
    return tokenTimeWindows;
  };

  // Match filled orders to calculate closed trades and P&L
  const calculateClosedTrades = (orders) => {
    const filledOrders = orders.filter(order => order.type === 'executed');
    console.log('🔍 calculateClosedTrades called with:', {
      totalOrders: orders.length,
      filledOrders: filledOrders.length,
      btcOrders: filledOrders.filter(o => o.token === 'BTC'),
      ethOrders: filledOrders.filter(o => o.token === 'ETH')
    });
    
    const trades = [];
    
    // Group filled orders by token
    const ordersByToken = {};
    filledOrders.forEach(order => {
      if (!ordersByToken[order.token]) {
        ordersByToken[order.token] = [];
      }
      ordersByToken[order.token].push(order);
    });
    
    console.log('🔍 Orders grouped by token:', {
      tokens: Object.keys(ordersByToken),
      btcOrders: ordersByToken['BTC'] || [],
      ethOrders: ordersByToken['ETH'] || []
    });
    
    // Process each token separately
    Object.keys(ordersByToken).forEach(token => {
      const tokenOrders = ordersByToken[token];
      console.log(`🔍 Processing ${token} orders:`, {
        totalOrders: tokenOrders.length,
        buyOrders: tokenOrders.filter(o => o.side === 'buy').length,
        sellOrders: tokenOrders.filter(o => o.side === 'sell').length,
        sampleOrders: tokenOrders.slice(0, 3)
      });
      
      // Sort by timestamp (oldest first)
      tokenOrders.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      let buyOrders = [];
      let sellOrders = [];
      
      // Separate buy and sell orders
      tokenOrders.forEach(order => {
        if (order.side === 'buy') {
          buyOrders.push({ ...order, remainingSize: parseFloat(order.size) });
        } else {
          sellOrders.push({ ...order, remainingSize: parseFloat(order.size) });
        }
      });
      
      console.log(`🔍 ${token} separated orders:`, {
        buyOrders: buyOrders.length,
        sellOrders: sellOrders.length,
        buySample: buyOrders.slice(0, 2),
        sellSample: sellOrders.slice(0, 2)
      });
      
      // Match buy and sell orders to create trades
      buyOrders.forEach(buyOrder => {
        let buySize = buyOrder.remainingSize;
        
        while (buySize > 0 && sellOrders.length > 0) {
          const sellOrder = sellOrders[0];
          const sellSize = sellOrder.remainingSize;
          
          if (sellSize <= 0) {
            sellOrders.shift(); // Remove empty sell order
            continue;
          }
          
          const tradeSize = Math.min(buySize, sellSize);
          const buyPrice = parseFloat(buyOrder.price);
          const sellPrice = parseFloat(sellOrder.price);
          
          // Calculate P&L
          const pnl = (sellPrice - buyPrice) * tradeSize;
          const pnlPercent = ((sellPrice - buyPrice) / buyPrice) * 100;
          
          // Create buy trade marker
          trades.push({
            id: `trade-buy-${trades.length}`,
            token: token,
            buyOrderId: buyOrder.orderId,
            sellOrderId: sellOrder.orderId,
            buyPrice: buyPrice,
            sellPrice: sellPrice,
            size: tradeSize,
            pnl: pnl,
            pnlPercent: pnlPercent,
            buyTimestamp: buyOrder.timestamp,
            sellTimestamp: sellOrder.timestamp,
            isProfitable: pnl > 0,
            // Add properties needed for chart markers
            side: 'buy', // This represents the entry side
            price: buyPrice, // Use buy price for chart marker
            timestamp: buyOrder.timestamp // Use buy timestamp for chart marker
          });
          
          // Create sell trade marker
          trades.push({
            id: `trade-sell-${trades.length}`,
            token: token,
            buyOrderId: buyOrder.orderId,
            sellOrderId: sellOrder.orderId,
            buyPrice: buyPrice,
            sellPrice: sellPrice,
            size: tradeSize,
            pnl: pnl,
            pnlPercent: pnlPercent,
            buyTimestamp: buyOrder.timestamp,
            sellTimestamp: sellOrder.timestamp,
            isProfitable: pnl > 0,
            // Add properties needed for chart markers
            side: 'sell', // This represents the exit side
            price: sellPrice, // Use sell price for chart marker
            timestamp: sellOrder.timestamp // Use sell timestamp for chart marker
          });
          
          // Update remaining sizes
          buySize -= tradeSize;
          sellOrder.remainingSize -= tradeSize;
          
          if (sellOrder.remainingSize <= 0) {
            sellOrders.shift(); // Remove empty sell order
          }
        }
      });
    });
    
    return trades;
  };

  useEffect(() => {
    if (ethereumAddress) {
      fetchHistoricalOrders();
    }
  }, [ethereumAddress]);

  const fetchHistoricalOrders = async () => {
    if (!ethereumAddress) return;

    setLoading(true);
    setError('');

    try {
      // Helper function to fetch paginated data
      const fetchPaginatedData = async (endpoint, type, maxOrders = 10000) => {
        let allData = [];
        let cursor = null;
        let hasMore = true;
        let pageCount = 0;
        const maxPages = 50; // Safety limit to prevent infinite loops
        
        console.log(`🔄 Starting paginated fetch for ${type} with max ${maxOrders} orders`);
        setLoadingProgress({ current: 0, total: maxOrders, message: `Fetching ${type}...` });
        
        while (hasMore && allData.length < maxOrders && pageCount < maxPages) {
          pageCount++;
          console.log(`📄 Fetching page ${pageCount} for ${type} (current total: ${allData.length})`);
          setLoadingProgress({ current: allData.length, total: maxOrders, message: `Fetching ${type} (page ${pageCount})...` });
          
          const requestBody = {
            type: type,
            user: ethereumAddress
          };
          
          // Add cursor for pagination if available
          if (cursor) {
            requestBody.cursor = cursor;
          }
          
          // Add limit parameter to get more orders per request
          requestBody.limit = Math.min(1000, maxOrders - allData.length);
          
          const response = await fetch(`${API_BASE_URL}/info`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
          });

          if (!response.ok) {
            console.warn(`⚠️ ${type} endpoint failed on page ${pageCount}:`, response.status);
            break;
          }

          const pageData = await response.json();
          console.log(`📥 Received ${pageData.length} orders for ${type} page ${pageCount}`);
          
          if (pageData.length === 0) {
            console.log(`✅ No more data for ${type} after ${pageCount} pages`);
            hasMore = false;
            break;
          }
          
          allData = allData.concat(pageData);
          
          // Check if we have a cursor for next page
          if (pageData.cursor) {
            cursor = pageData.cursor;
          } else if (pageData.length < requestBody.limit) {
            // If we got fewer results than requested, we've reached the end
            hasMore = false;
          } else {
            // If no cursor but we got a full page, try to continue with offset
            cursor = allData.length;
          }
          
          // Add a small delay to avoid rate limiting
          if (hasMore) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        
        console.log(`✅ Completed paginated fetch for ${type}: ${allData.length} total orders in ${pageCount} pages`);
        return allData;
      };

      // Get open orders with pagination
      const openOrdersData = await fetchPaginatedData('openOrders', 'openOrders', 5000);
      console.log('Raw open orders data:', openOrdersData);
      
      // Get frontend open orders with additional details
      const frontendOpenOrdersData = await fetchPaginatedData('frontendOpenOrders', 'frontendOpenOrders', 5000);
      console.log('Raw frontend open orders data:', frontendOpenOrdersData);
      
      // Use frontend open orders if available, otherwise fall back to regular open orders
      const finalOpenOrdersData = frontendOpenOrdersData.length > 0 ? frontendOpenOrdersData : openOrdersData;
      
      console.log('🔍 Open orders analysis:', {
        regularOpenOrders: openOrdersData.length,
        frontendOpenOrders: frontendOpenOrdersData.length,
        finalOpenOrders: finalOpenOrdersData.length,
        sampleRegularOrder: openOrdersData[0],
        sampleFrontendOrder: frontendOpenOrdersData[0],
        // Check for scale order patterns
        ordersByToken: finalOpenOrdersData.reduce((acc, order) => {
          acc[order.coin] = (acc[order.coin] || 0) + 1;
          return acc;
        }, {}),
        // Check for same-price orders (potential scale orders)
        priceAnalysis: finalOpenOrdersData.reduce((acc, order) => {
          const key = `${order.coin}-${order.side}-${order.limitPx}`;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {})
      });
      
      // Get executed orders (user fills) with pagination
      const userFillsData = await fetchPaginatedData('userFills', 'userFills', 10000);
      console.log('Raw user fills data:', userFillsData);
      
      // Get TWAP slice fills (TWAP orders) with pagination
      const twapFillsData = await fetchPaginatedData('userTwapSliceFills', 'userTwapSliceFills', 10000);
      console.log('Raw TWAP fills data:', twapFillsData);
      
      // Log detailed TWAP data structure
      if (twapFillsData.length > 0) {
        console.log('🔍 TWAP data analysis:', {
          totalTwapFills: twapFillsData.length,
          sampleFill: twapFillsData[0],
          allCoins: [...new Set(twapFillsData.map(twapData => {
            const fill = twapData.fill || twapData;
            return fill.coin;
          }))],
          coinsWithCounts: twapFillsData.reduce((acc, twapData) => {
            const fill = twapData.fill || twapData;
            acc[fill.coin] = (acc[fill.coin] || 0) + 1;
            return acc;
          }, {}),
          allDirections: [...new Set(twapFillsData.map(twapData => {
            const fill = twapData.fill || twapData;
            return fill.dir;
          }))],
          crossedCount: twapFillsData.filter(twapData => {
            const fill = twapData.fill || twapData;
            return fill.crossed;
          }).length
        });
        
        // Debug: Check all available fields in TWAP data
        console.log('🔍 TWAP data field analysis:', {
          sampleFillKeys: Object.keys(twapFillsData[0]),
          sampleFillValues: twapFillsData[0],
          hasNestedFill: 'fill' in twapFillsData[0],
          nestedFillKeys: twapFillsData[0].fill ? Object.keys(twapFillsData[0].fill) : null,
          coinFieldValue: twapFillsData[0].fill ? twapFillsData[0].fill.coin : twapFillsData[0].coin,
          twapId: twapFillsData[0].twapId
        });
        
        // Check if coin field is missing or null
        const missingCoinCount = twapFillsData.filter(twapData => {
          const fill = twapData.fill || twapData;
          return !fill.coin || fill.coin === 'Unknown';
        }).length;
        console.log('🔍 Coin field analysis:', {
          totalFills: twapFillsData.length,
          missingCoinCount,
          hasCoinField: twapFillsData.every(twapData => {
            const fill = twapData.fill || twapData;
            return fill.coin;
          }),
          coinFieldTypes: [...new Set(twapFillsData.map(twapData => {
            const fill = twapData.fill || twapData;
            return typeof fill.coin;
          }))],
          sampleCoinValues: twapFillsData.slice(0, 5).map(twapData => {
            const fill = twapData.fill || twapData;
            return fill.coin;
          })
        });
        
        // NEW: Detailed side analysis for TWAP orders
        console.log('🔍 TWAP SIDE ANALYSIS:', {
          totalTwapFills: twapFillsData.length,
          allSideValues: [...new Set(twapFillsData.map(twapData => {
            const fill = twapData.fill || twapData;
            return fill.side;
          }))],
          sideValueCounts: twapFillsData.reduce((acc, twapData) => {
            const fill = twapData.fill || twapData;
            const side = fill.side;
            acc[side] = (acc[side] || 0) + 1;
            return acc;
          }, {}),
          sampleSideValues: twapFillsData.slice(0, 10).map(twapData => {
            const fill = twapData.fill || twapData;
            return {
              side: fill.side,
              dir: fill.dir,
              coin: fill.coin,
              mappedSide: fill.side === 'A' ? 'sell' : 'buy'
            };
          }),
          // Check for HYPE-specific TWAP orders
          hypeTwapOrders: twapFillsData.filter(twapData => {
            const fill = twapData.fill || twapData;
            return fill.coin === 'HYPE';
          }).map(twapData => {
            const fill = twapData.fill || twapData;
            return {
              side: fill.side,
              dir: fill.dir,
              mappedSide: fill.side === 'A' ? 'sell' : 'buy',
              timestamp: fill.time,
              price: fill.px,
              size: fill.sz
            };
          })
        });
      }
      
      // Get cancelled orders (important for order blocks) with pagination
      const cancelledOrdersData = await fetchPaginatedData('userCancelledOrders', 'userCancelledOrders', 5000);
      console.log('Raw cancelled orders data:', cancelledOrdersData);
      
      // If cancelled orders endpoint fails, try alternative endpoint
      if (cancelledOrdersData.length === 0) {
        console.warn('Cancelled orders endpoint returned no data, trying alternative endpoint');
        const alternativeCancelledData = await fetchPaginatedData('userOrderHistory', 'userOrderHistory', 5000);
        console.log('Alternative order history data:', alternativeCancelledData);
        // Filter for cancelled orders from the general order history
        const filteredCancelledData = alternativeCancelledData.filter(order => 
          order.status === 'cancelled' || order.status === 'canceled' || order.cancelled
        );
        console.log('Filtered cancelled orders from alternative endpoint:', filteredCancelledData);
        cancelledOrdersData.push(...filteredCancelledData);
      }
      
      // Transform open orders
      const transformedOpenOrders = finalOpenOrdersData.map(order => ({
        id: `open-${order.oid || Math.random().toString(36).substr(2, 9)}`,
        token: order.coin || 'Unknown',
        side: order.side === 'A' ? 'sell' : 'buy',
        size: order.sz || '0',
        price: order.limitPx || '0',
        status: 'pending',
        timestamp: order.timestamp ? new Date(order.timestamp).toISOString() : new Date().toISOString(),
        orderId: order.oid?.toString() || '',
        reduceOnly: false,
        type: 'open'
      }));

      console.log('🔍 Transformed open orders with tokens:', {
        totalOrders: transformedOpenOrders.length,
        tokens: transformedOpenOrders.map(o => o.token),
        uniqueTokens: [...new Set(transformedOpenOrders.map(o => o.token))],
        sampleOrder: transformedOpenOrders[0],
        // Detailed breakdown by token and side
        ordersByTokenAndSide: transformedOpenOrders.reduce((acc, order) => {
          const key = `${order.token}-${order.side}`;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
        // Check for potential scale orders (same price, same side)
        potentialScaleOrders: transformedOpenOrders.reduce((acc, order) => {
          const key = `${order.token}-${order.side}-${order.price}`;
          if (!acc[key]) {
            acc[key] = [];
          }
          acc[key].push(order);
          return acc;
        }, {}),
        // Show orders with multiple entries at same price (likely scale orders)
        scaleOrderCandidates: Object.entries(transformedOpenOrders.reduce((acc, order) => {
          const key = `${order.token}-${order.side}-${order.price}`;
          if (!acc[key]) {
            acc[key] = [];
          }
          acc[key].push(order);
          return acc;
        }, {})).filter(([key, orders]) => orders.length > 1).map(([key, orders]) => ({
          key,
          count: orders.length,
          sampleOrder: orders[0]
        }))
      });

      // Transform executed orders
      const transformedExecutedOrders = userFillsData.map(fill => ({
        id: `executed-${fill.oid || Math.random().toString(36).substr(2, 9)}`,
        token: fill.coin || 'Unknown',
        side: fill.side === 'A' ? 'sell' : 'buy',
        size: fill.sz || '0',
        price: fill.px || '0',
        status: 'filled',
        timestamp: fill.time ? new Date(fill.time).toISOString() : new Date().toISOString(),
        orderId: fill.oid?.toString() || '',
        reduceOnly: false,
        type: 'executed'
      }));

      console.log('🔍 Transformed executed orders with tokens:', {
        totalOrders: transformedExecutedOrders.length,
        tokens: transformedExecutedOrders.map(o => o.token),
        uniqueTokens: [...new Set(transformedExecutedOrders.map(o => o.token))],
        sampleOrder: transformedExecutedOrders[0]
      });

      // Transform TWAP fills
      const transformedTwapOrders = twapFillsData.map(twapData => {
        // Handle nested fill structure
        const fill = twapData.fill || twapData;
        
        return {
          id: `twap-${fill.oid || Math.random().toString(36).substr(2, 9)}`,
          token: fill.coin || 'Unknown',
          side: fill.side === 'A' ? 'sell' : 'buy',
          size: fill.sz || '0',
          price: fill.px || '0',
          status: 'filled',
          timestamp: fill.time ? new Date(fill.time).toISOString() : new Date().toISOString(),
          orderId: fill.oid?.toString() || '',
          reduceOnly: false,
          type: 'twap',
          isTwap: true,
          direction: fill.dir || 'Unknown',
          crossed: fill.crossed || false,
          fee: fill.fee || '0',
          feeToken: fill.feeToken || 'USDC',
          hash: fill.hash || '',
          tid: fill.tid || null,
          startPosition: fill.startPosition || '0',
          closedPnl: fill.closedPnl || '0',
          twapId: twapData.twapId || null,
          // Store original data for debugging
          originalFill: fill
        };
      });

      console.log('🔍 Transformed TWAP orders with tokens:', {
        totalOrders: transformedTwapOrders.length,
        tokens: transformedTwapOrders.map(o => o.token),
        uniqueTokens: [...new Set(transformedTwapOrders.map(o => o.token))],
        sampleOrder: transformedTwapOrders[0],
        // Analysis of transformation results
        unknownTokenCount: transformedTwapOrders.filter(o => o.token === 'Unknown').length,
        knownTokenCount: transformedTwapOrders.filter(o => o.token !== 'Unknown').length,
        tokenDistribution: transformedTwapOrders.reduce((acc, order) => {
          acc[order.token] = (acc[order.token] || 0) + 1;
          return acc;
        }, {}),
        // Show sample of orders that couldn't be mapped
        sampleUnknownOrders: transformedTwapOrders.filter(o => o.token === 'Unknown').slice(0, 3).map(o => o.originalFill)
      });

      // Verify TWAP transformation
      if (transformedTwapOrders.length > 0) {
        console.log('✅ TWAP transformation successful');
        console.log('Sample TWAP order:', transformedTwapOrders[0]);
      }

      // Transform cancelled orders
      const transformedCancelledOrders = cancelledOrdersData.map(order => {
        // Handle different possible data structures for cancelled orders
        const orderData = order.order || order;
        
        return {
          id: `cancelled-${orderData.oid || Math.random().toString(36).substr(2, 9)}`,
          token: orderData.coin || 'Unknown',
          side: orderData.side === 'A' ? 'sell' : 'buy',
          size: orderData.sz || orderData.size || '0',
          price: orderData.limitPx || orderData.price || '0',
          status: 'cancelled',
          timestamp: orderData.timestamp ? new Date(orderData.timestamp).toISOString() : new Date().toISOString(),
          orderId: orderData.oid?.toString() || '',
          reduceOnly: false,
          type: 'cancelled',
          // Additional fields for order block analysis
          originalSize: orderData.originalSz || orderData.originalSize || orderData.sz || '0',
          filledSize: orderData.filledSz || orderData.filledSize || '0',
          cancelledSize: orderData.cancelledSz || orderData.cancelledSize || '0',
          // Calculate unfilled portion (important for order blocks)
          unfilledSize: (parseFloat(orderData.originalSz || orderData.originalSize || orderData.sz || '0') - 
                        parseFloat(orderData.filledSz || orderData.filledSize || '0')).toString(),
          // Store original data for debugging
          originalOrder: orderData
        };
      });

      console.log('🔍 Transformed cancelled orders with tokens:', {
        totalOrders: transformedCancelledOrders.length,
        tokens: transformedCancelledOrders.map(o => o.token),
        uniqueTokens: [...new Set(transformedCancelledOrders.map(o => o.token))],
        sampleOrder: transformedCancelledOrders[0],
        // Analysis of cancelled orders
        ordersWithUnfilledPortions: transformedCancelledOrders.filter(o => parseFloat(o.unfilledSize) > 0).length,
        totalUnfilledSize: transformedCancelledOrders.reduce((sum, o) => sum + parseFloat(o.unfilledSize), 0),
        // Show sample of orders with unfilled portions (important for order blocks)
        sampleUnfilledOrders: transformedCancelledOrders
          .filter(o => parseFloat(o.unfilledSize) > 0)
          .slice(0, 3)
          .map(o => ({
            token: o.token,
            side: o.side,
            price: o.price,
            originalSize: o.originalSize,
            filledSize: o.filledSize,
            unfilledSize: o.unfilledSize
          }))
      });

      // Combine and sort by timestamp (newest first)
      const allOrders = [...transformedOpenOrders, ...transformedExecutedOrders, ...transformedTwapOrders, ...transformedCancelledOrders]
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      console.log('Final combined orders:', {
        totalOrders: allOrders.length,
        openOrders: allOrders.filter(o => o.type === 'open').length,
        executedOrders: allOrders.filter(o => o.type === 'executed').length,
        twapOrders: allOrders.filter(o => o.type === 'twap').length,
        cancelledOrders: allOrders.filter(o => o.type === 'cancelled').length,
        // Breakdown by token
        ordersByToken: allOrders.reduce((acc, order) => {
          acc[order.token] = (acc[order.token] || 0) + 1;
          return acc;
        }, {}),
        // Open orders by token and side
        openOrdersByTokenAndSide: allOrders.filter(o => o.type === 'open').reduce((acc, order) => {
          const key = `${order.token}-${order.side}`;
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
        // Sample of open orders
        sampleOpenOrders: allOrders.filter(o => o.type === 'open').slice(0, 5)
      });
      
      setOrders(allOrders);

      // Pass orders to parent component
      if (onOrdersUpdate) {
        onOrdersUpdate(allOrders);
      }

      // Calculate time windows for each token and pass to parent
      const timeWindows = calculateTimeWindows(allOrders);
      console.log('Calculated time windows:', timeWindows);
      if (onTimeWindowUpdate) {
        onTimeWindowUpdate(timeWindows);
      }

      // Calculate closed trades and P&L
      const trades = calculateClosedTrades(allOrders);
      console.log('🔍 Calculated closed trades:', {
        totalTrades: trades.length,
        tradesByToken: trades.reduce((acc, trade) => {
          acc[trade.token] = (acc[trade.token] || 0) + 1;
          return acc;
        }, {}),
        sampleTrades: trades.slice(0, 3),
        btcTrades: trades.filter(t => t.token === 'BTC'),
        ethTrades: trades.filter(t => t.token === 'ETH')
      });

      // Pass trades to parent component
      if (onTradesUpdate) {
        onTradesUpdate(trades);
      }

    } catch (err) {
      console.error('Error fetching orders:', err);
      setError(`Failed to fetch historical orders: ${err.message}`);
    } finally {
      setLoading(false);
      setLoadingProgress({ current: 0, total: 0, message: '' });
    }
  };

  // Memoize unique tokens to prevent unnecessary recalculations
  const uniqueTokens = useMemo(() => {
    const tokens = [...new Set(orders.map(order => order.token))];
    console.log('🔍 Extracted tokens from orders:', {
      allTokens: orders.map(order => order.token),
      uniqueTokens: tokens,
      tokenCount: tokens.length
    });
    return tokens.sort();
  }, [orders]);

  // Memoize filtered orders for better performance
  const filteredOrders = useMemo(() => {
    let filtered = orders;
    
    // Filter by selected token
    if (selectedToken !== 'all') {
      const beforeFilter = filtered.length;
      filtered = filtered.filter(order => order.token === selectedToken);
      const afterFilter = filtered.length;
      
      // Log filtering details for debugging
      console.log('🔍 Token filtering applied:', {
        selectedToken,
        beforeFilter,
        afterFilter,
        filteredOut: beforeFilter - afterFilter,
        twapOrdersBefore: orders.filter(o => o.isTwap).length,
        twapOrdersAfter: filtered.filter(o => o.isTwap).length,
        twapOrdersForToken: orders.filter(o => o.isTwap && o.token === selectedToken).length,
        // Detailed breakdown of what was filtered
        allOrdersForToken: orders.filter(o => o.token === selectedToken).length,
        openOrdersForToken: orders.filter(o => o.token === selectedToken && o.type === 'open').length,
        executedOrdersForToken: orders.filter(o => o.token === selectedToken && o.type === 'executed').length,
        twapOrdersForToken: orders.filter(o => o.token === selectedToken && o.type === 'twap').length,
        // Show sample TWAP orders for this token
        sampleTwapOrdersForToken: orders.filter(o => o.token === selectedToken && o.type === 'twap').slice(0, 3)
      });
    }
    
    // Filter by search term
    if (debouncedSearchTerm) {
      const searchLower = debouncedSearchTerm.toLowerCase();
      filtered = filtered.filter(order => 
        order.token.toLowerCase().includes(searchLower) ||
        order.orderId.toLowerCase().includes(searchLower) ||
        order.side.toLowerCase().includes(searchLower) ||
        order.status.toLowerCase().includes(searchLower) ||
        (order.isTwap && order.direction && order.direction.toLowerCase().includes(searchLower)) ||
        (order.isTwap && order.crossed && 'crossed'.includes(searchLower)) ||
        (order.isTwap && 'twap'.includes(searchLower))
      );
    }
    
    // Limit to 10 most recent orders for display
    return filtered.slice(0, 10);
  }, [orders, selectedToken, debouncedSearchTerm]);

  // Memoize total count for display
  const totalFilteredCount = useMemo(() => {
    if (selectedToken === 'all') {
      return orders.length;
    }
    return orders.filter(order => order.token === selectedToken).length;
  }, [orders, selectedToken]);

  // Memoize TWAP statistics
  const twapStats = useMemo(() => {
    const twapOrders = orders.filter(order => order.isTwap);
    const twapByToken = twapOrders.reduce((acc, order) => {
      acc[order.token] = (acc[order.token] || 0) + 1;
      return acc;
    }, {});
    
    const twapByDirection = twapOrders.reduce((acc, order) => {
      const direction = order.direction || 'Unknown';
      acc[direction] = (acc[direction] || 0) + 1;
      return acc;
    }, {});
    
    const crossedCount = twapOrders.filter(order => order.crossed).length;
    
    return {
      total: twapOrders.length,
      byToken: twapByToken,
      byDirection: twapByDirection,
      crossed: crossedCount,
      tokens: Object.keys(twapByToken),
      directions: Object.keys(twapByDirection)
    };
  }, [orders]);

  const handleTokenFilterClick = (token) => {
    console.log('🎯 Token selected:', {
      token,
      previousToken: selectedToken,
      isNewToken: token !== selectedToken
    });
    onTokenSelect(token);
  };

  // Debounce search term to improve performance
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  if (!ethereumAddress) {
    return (
      <div className="order-manager">
        <h2>Order History</h2>
        <div className="no-address">
          <p>Please enter your Ethereum address to view order history</p>
        </div>
      </div>
    );
  }

  return (
    <div className="order-manager">
      <h2>Order History</h2>
      
      <div className="orders-header">
        <div className="header-left">
          <p>Showing orders for: {ethereumAddress}</p>
          
          {/* Search input for large datasets */}
          {orders.length > 100 && (
            <div className="search-container">
              <input
                type="text"
                placeholder="Search orders by token, ID, side, or status..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              {debouncedSearchTerm && (
                <span className="search-results">
                  Found {filteredOrders.length} results
                </span>
              )}
            </div>
          )}
          
          <div className="token-filter">
            <span className="filter-label">Filter by Token:</span>
            <div className="token-buttons">
              {uniqueTokens.map(token => {
                const tokenCount = orders.filter(order => order.token === token).length;
                const twapCount = orders.filter(order => order.token === token && order.isTwap).length;
                const displayCount = tokenCount > 10 ? `10/${tokenCount}` : tokenCount;
                const twapIndicator = twapCount > 0 ? ` (${twapCount} TWAP)` : '';
                return (
                  <button
                    key={token}
                    className={`token-btn ${selectedToken === token ? 'active' : ''}`}
                    onClick={() => handleTokenFilterClick(token)}
                  >
                    {token} ({displayCount}{twapIndicator})
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <button 
          onClick={fetchHistoricalOrders} 
          className="refresh-btn"
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {/* Performance warning for large datasets */}
      {orders.length > 1000 && (
        <div className="performance-warning">
          <span>⚠️ Large dataset ({orders.length} orders) - clustering active</span>
        </div>
      )}

      {/* TWAP Statistics */}
      {twapStats.total > 0 && (
        <div className="twap-stats">
          <h3>TWAP Orders Found</h3>
          <div className="twap-summary">
            <p>Total TWAP orders: <strong>{twapStats.total}</strong></p>
            {twapStats.crossed > 0 && (
              <p>Crossed orders: <strong>{twapStats.crossed}</strong></p>
            )}
            {twapStats.tokens.length > 0 && (
              <div className="twap-by-token">
                <span>By token: </span>
                {twapStats.tokens.map(token => (
                  <span key={token} className="twap-token-stat">
                    {token}: {twapStats.byToken[token]}
                  </span>
                ))}
              </div>
            )}
            {twapStats.directions.length > 0 && (
              <div className="twap-by-direction">
                <span>By direction: </span>
                {twapStats.directions.map(direction => (
                  <span key={direction} className="twap-direction-stat">
                    {direction}: {twapStats.byDirection[direction]}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="orders-list">
        {loading ? (
          <div className="loading">
            <p>Loading historical orders...</p>
            {loadingProgress.total > 0 && (
              <div className="loading-progress">
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ width: `${(loadingProgress.current / loadingProgress.total) * 100}%` }}
                  ></div>
                </div>
                <p className="progress-text">
                  {loadingProgress.message} ({loadingProgress.current}/{loadingProgress.total})
                </p>
              </div>
            )}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="no-orders">
            <p>
              {selectedToken === 'all' 
                ? 'No historical orders found' 
                : `No orders found for ${selectedToken}`
              }
            </p>
          </div>
        ) : (
          <div className="orders-table">
            <div className="table-header">
              <span>Token</span>
              <span>Side</span>
              <span>Size</span>
              <span>Price</span>
              <span>Status</span>
              <span>Order ID</span>
            </div>
            {filteredOrders.map(order => (
              <div key={order.id} className={`table-row ${order.isTwap ? 'twap-order' : ''} ${order.type === 'cancelled' ? 'cancelled-order' : ''}`}>
                <span className="token">
                  {order.token}
                  {order.isTwap && <span className="twap-badge">TWAP</span>}
                  {order.type === 'cancelled' && parseFloat(order.unfilledSize) > 0 && (
                    <span className="unfilled-badge">UNFILLED</span>
                  )}
                </span>
                <span className={`side ${order.side}`}>
                  {order.side.toUpperCase()}
                  {order.isTwap && order.direction && (
                    <span className="twap-direction"> ({order.direction})</span>
                  )}
                </span>
                <span className="size">
                  {order.type === 'cancelled' && parseFloat(order.unfilledSize) > 0 ? (
                    <div className="size-breakdown">
                      <span className="original-size">{order.originalSize}</span>
                      <span className="size-separator">→</span>
                      <span className="filled-size">{order.filledSize}</span>
                      <span className="size-separator">+</span>
                      <span className="unfilled-size">{order.unfilledSize}</span>
                    </div>
                  ) : (
                    order.size
                  )}
                </span>
                <span className="price">${order.price}</span>
                <span className={`status status-${order.status}`}>
                  {order.status}
                  {order.isTwap && order.crossed && (
                    <span className="twap-crossed"> (Crossed)</span>
                  )}
                  {order.type === 'cancelled' && parseFloat(order.unfilledSize) > 0 && (
                    <span className="unfilled-indicator"> (Unfilled: {order.unfilledSize})</span>
                  )}
                </span>
                <span className="order-id">{order.orderId}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderManager; 