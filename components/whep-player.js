/* /components/whep-player.js  –  WebRTC-HTTP Egress Protocol (WHEP) player
   Usage examples:
     <whep-player url="https://customer-abc.cloudflarestream.com/whep/xyz"></whep-player>
     <whep-player url="https://..." autoplay muted></whep-player>
*/

customElements.define("whep-player", class extends HTMLElement {
  connectedCallback() {
    const url = this.getAttribute("url");
    if (!url) {
      console.warn("<whep-player> missing url attribute");
      this.innerHTML = '<p style="color: red;">Error: WHEP URL is required</p>';
      return;
    }

    const autoplay = this.hasAttribute("autoplay");
    const muted = this.hasAttribute("muted");
    
    // Detect mobile for audio handling
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    this.innerHTML = `
      <div style="position: relative; width: 100%; max-width: 100%;">
        <video 
          style="width: 100%; max-width: 100%; border-radius: 8px; background: #000;"
          controls 
          ${autoplay ? 'autoplay' : ''} 
          ${muted || isMobile ? 'muted' : ''}
          playsinline
        ></video>
        ${isMobile ? '<div class="mobile-unmute" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.8); color: white; padding: 20px 30px; border-radius: 8px; font-size: 18px; cursor: pointer; display: none; z-index: 10; pointer-events: auto;">🔊 Tap for Audio</div>' : ''}
        <div class="whep-status" style="margin-top: 8px; font-size: 0.9em; color: #666;"></div>
      </div>
    `;

    const video = this.querySelector('video');
    const status = this.querySelector('.whep-status');
    const mobileUnmute = this.querySelector('.mobile-unmute');
    
    // Mobile audio unmute handler
    if (isMobile && mobileUnmute) {
      let isSetup = false;
      
      // Show unmute button after video starts playing
      video.addEventListener('playing', () => {
        if (!isSetup && video.muted) {
          mobileUnmute.style.display = 'block';
          isSetup = true;
        }
      });
      
      // Handle tap to unmute
      mobileUnmute.addEventListener('click', () => {
        video.muted = false;
        video.volume = 1.0;
        mobileUnmute.style.display = 'none';
        console.log('Mobile: unmuted via user interaction');
      });
      
      // Also unmute if user taps the video directly
      video.addEventListener('click', () => {
        if (video.muted) {
          video.muted = false;
          video.volume = 1.0;
          if (mobileUnmute) mobileUnmute.style.display = 'none';
          console.log('Mobile: unmuted via video click');
        }
      }, { once: true });
    }
    
    const retryOnConflict = this.hasAttribute('retry');
    this.playWHEP(url, video, status, retryOnConflict);
  }

  async playWHEP(whepUrl, videoElement, statusElement, retryOn409 = false, attempt = 1) {
    try {
      statusElement.textContent = '🔄 Connecting to stream...';

      // Create RTCPeerConnection with ICE servers
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      // Handle incoming media tracks
      let receivedTracks = [];
      let videoTrack = null;
      let audioTrack = null;
      
      pc.ontrack = (event) => {
        console.log('Received track:', event.track.kind);
        receivedTracks.push(event.track);
        
        if (event.track.kind === 'video') {
          videoTrack = event.track;
        } else if (event.track.kind === 'audio') {
          audioTrack = event.track;
          const settings = event.track.getSettings();
          console.log('Audio: channelCount=' + (settings.channelCount || 'unknown') + ', sampleRate=' + (settings.sampleRate || 'unknown'));
        }
        
        // Wait until we have both tracks, then set up the stream
        if (videoTrack && audioTrack) {
          console.log('Setting up stream with video + audio tracks');
          
          // Create a new MediaStream with both tracks explicitly
          const stream = new MediaStream([videoTrack, audioTrack]);
          
          videoElement.srcObject = stream;
          audioTrack.enabled = true;
          
          // Try to play
          setTimeout(() => {
            videoElement.play().then(() => {
              console.log('Playback started');
              statusElement.textContent = '✅ Connected & Playing';
              setTimeout(() => statusElement.textContent = '', 3000);
            }).catch(err => {
              console.error('Autoplay failed:', err);
              statusElement.textContent = '⚠️ Click play button to start';
              statusElement.style.color = '#ff9800';
            });
          }, 200);
        }
      };

      // Handle connection state changes
      pc.onconnectionstatechange = () => {
        console.log('Connection state:', pc.connectionState);
        if (pc.connectionState === 'failed') {
          statusElement.textContent = '❌ Connection failed';
          statusElement.style.color = '#d32f2f';
        }
      };

      // Add transceivers for receiving video and audio
      pc.addTransceiver('video', { direction: 'recvonly' });
      
      // Configure audio transceiver for high-quality stereo
      const audioTransceiver = pc.addTransceiver('audio', { 
        direction: 'recvonly'
      });

      // Create SDP offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await pc.setLocalDescription(offer);
      
      // Modify SDP to request stereo and high bitrate
      let sdp = offer.sdp;
      
      // Find the Opus payload type number
      const opusMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/);
      if (opusMatch) {
        const opusPayload = opusMatch[1];
        // Find and modify the fmtp line for this payload
        const fmtpRegex = new RegExp(`(a=fmtp:${opusPayload} .*)`, 'g');
        sdp = sdp.replace(fmtpRegex, (match) => {
          if (!match.includes('stereo=')) {
            return match + ';stereo=1;sprop-stereo=1;maxaveragebitrate=510000;cbr=1';
          }
          return match;
        });
      }
      
      // Update the local description with modified SDP
      await pc.setLocalDescription({
        type: 'offer',
        sdp: sdp
      });

      // Send offer to WHEP endpoint
      console.log('Connecting to WHEP endpoint:', whepUrl);
      const response = await fetch(whepUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/sdp'
        },
        body: sdp
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('WHEP error response:', errorText);
        
        // Retry on 409 if stream is starting up
        if (response.status === 409 && retryOn409 && attempt < 10) {
          statusElement.textContent = `🔄 Waiting for stream to start... (attempt ${attempt})`;
          console.log(`Retrying in 2 seconds (attempt ${attempt}/10)...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          return this.playWHEP(whepUrl, videoElement, statusElement, retryOn409, attempt + 1);
        }
        
        throw new Error(`WHEP request failed: ${response.status} ${response.statusText}${errorText ? ' - ' + errorText : ''}`);
      }

      // Get SDP answer and set as remote description
      const answerSdp = await response.text();
      
      await pc.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp
      });

      console.log('WHEP connection established');
      
      // Store peer connection for cleanup
      this._pc = pc;
      
    } catch (error) {
      console.error('WHEP playback error:', error);
      statusElement.textContent = `❌ Error: ${error.message}`;
      statusElement.style.color = '#d32f2f';
    }
  }

  disconnectedCallback() {
    // Clean up peer connection when element is removed
    if (this._pc) {
      this._pc.close();
      this._pc = null;
    }
  }
});

