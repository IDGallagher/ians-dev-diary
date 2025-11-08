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

    this.innerHTML = `
      <div style="position: relative; width: 100%; max-width: 100%;">
        <video 
          style="width: 100%; max-width: 100%; border-radius: 8px; background: #000;"
          controls 
          ${autoplay ? 'autoplay' : ''} 
          ${muted ? 'muted' : ''}
          playsinline
        ></video>
        <div class="whep-status" style="margin-top: 8px; font-size: 0.9em; color: #666;"></div>
      </div>
    `;

    const video = this.querySelector('video');
    const status = this.querySelector('.whep-status');
    
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
      let hasSetStream = false;
      pc.ontrack = (event) => {
        console.log('Received track:', event.track.kind);
        
        // Only set srcObject once to avoid interrupting playback
        if (!hasSetStream) {
          hasSetStream = true;
          videoElement.srcObject = event.streams[0];
          
          // Wait a moment for all tracks to be added, then play
          setTimeout(() => {
            videoElement.play().then(() => {
              console.log('Video playback started');
              statusElement.textContent = '✅ Connected & Playing';
              setTimeout(() => statusElement.textContent = '', 3000);
            }).catch(err => {
              console.error('Autoplay failed:', err);
              statusElement.textContent = '⚠️ Click video to play';
              statusElement.style.color = '#ff9800';
            });
          }, 100);
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
      pc.addTransceiver('audio', { direction: 'recvonly' });

      // Create SDP offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Send offer to WHEP endpoint
      console.log('Sending WHEP request to:', whepUrl);
      const response = await fetch(whepUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/sdp'
        },
        body: offer.sdp
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

