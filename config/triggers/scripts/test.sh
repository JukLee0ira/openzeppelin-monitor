#!/usr/bin/env bash
################################################################################
# Telegram Configuration Test Script
#
# This script validates Telegram configuration and tests connectivity.
#
# Input: JSON object containing Telegram configuration
# Output: Validation results and connectivity test results
################################################################################

# Enable error handling
set -e

test_telegram_api() {
    local token="$1"
    local chat_id="$2"
    local test_message="🔔 Test notification from OpenZeppelin Monitor"
    
    # Test the Telegram Bot API
    response=$(curl -s "https://api.telegram.org/bot${token}/sendMessage" \
        -d "chat_id=${chat_id}" \
        -d "text=${test_message}" \
        -d "parse_mode=HTML")
    
    if echo "$response" | jq -e '.ok == true' >/dev/null; then
        echo "✅ Telegram connection test successful!"
        echo "Message sent to chat_id: ${chat_id}"
        return 0
    else
        echo "❌ Telegram connection test failed!"
        echo "Error: $(echo "$response" | jq -r '.description // "Unknown error"')"
        return 1
    fi
}

main() {
    # Read Telegram config file
    if [ ! -f "config/triggers/mint_telegram.json" ]; then
        echo "❌ Error: mint_telegram.json not found!"
        exit 1
    fi

    echo "📝 Reading Telegram configuration..."
    
    # Extract token and chat_id
    config=$(cat config/triggers/mint_telegram.json)
    
    if ! echo "$config" | jq . >/dev/null 2>&1; then
        echo "❌ Error: Invalid JSON in mint_telegram.json"
        exit 1
    fi

    echo "✅ JSON format validation passed"

    # Extract and validate configuration
    token=$(echo "$config" | jq -r '.mint_telegram.config.token.value')
    chat_id=$(echo "$config" | jq -r '.mint_telegram.config.chat_id')
    
    if [ "$token" = "null" ] || [ -z "$token" ]; then
        echo "❌ Error: Telegram token not found in configuration"
        exit 1
    fi

    if [ "$chat_id" = "null" ] || [ -z "$chat_id" ]; then
        echo "❌ Error: Chat ID not found in configuration"
        exit 1
    fi

    echo "✅ Configuration validation passed"
    echo "🔑 Token: ${token:0:10}...${token: -4}"
    echo "👥 Chat ID: $chat_id"
    
    echo "🔄 Testing Telegram connection..."
    if test_telegram_api "$token" "$chat_id"; then
        echo "✨ All tests passed! Your Telegram configuration is working correctly."
    else
        echo "❌ Telegram connection test failed. Please check your token and chat_id."
        exit 1
    fi
}

# Call main function
main