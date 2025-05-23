# Subtitle Overlay Chrome Extension

This Chrome extension allows you to upload SRT subtitle files and display them over videos playing in your browser.

## Features

- Upload any .srt subtitle file
- Automatically syncs subtitles with video playback timing
- Works with most video streaming sites
- Subtitles stay in sync when pausing/playing
- Clean, readable subtitle styling

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" using the toggle in the top-right corner
4. Click "Load unpacked" and select the folder containing this extension
5. The extension icon should now appear in your Chrome toolbar

## Usage

1. Navigate to a page with a video
2. Click the Subtitle Overlay extension icon in your toolbar
3. Click "Choose File" and select your .srt subtitle file
4. Click "Apply Subtitles"
5. The subtitles should now appear overlaid on the video

## Troubleshooting

- If subtitles don't appear, try refreshing the page and reapplying
- Make sure your .srt file is properly formatted
- If using on a streaming site that constantly refreshes the video player, you may need to reapply subtitles

## Notes

- The extension looks for the largest video element on the page
- Subtitles are positioned at the bottom of the video player
- This extension does not modify or download the video content
- Your subtitle files are processed locally, not uploaded anywhere 