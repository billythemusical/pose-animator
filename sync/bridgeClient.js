// Browser side of the bridge: connects to /bridge, reconnects if the server
// restarts (for example when Vite reloads), and hands messages to listeners.

export function connectBridge(role, onMessage, onConnection = () => {}, onBinary = () => {}) {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${scheme}://${location.host}/bridge`;
  let socket = null;

  function open() {
    socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      socket.send(JSON.stringify({type: 'hello', role}));
      onConnection(true);
    };
    socket.onmessage = (event) => {
      if (typeof event.data === 'string') onMessage(JSON.parse(event.data));
      else onBinary(event.data);
    };
    socket.onclose = () => {
      onConnection(false);
      setTimeout(open, 1000);
    };
  }
  open();

  return {
    send(message) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    },
    sendBinary(buffer) {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(buffer);
    },
  };
}
