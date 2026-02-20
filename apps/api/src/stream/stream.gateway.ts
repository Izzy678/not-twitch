import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    MessageBody,
    ConnectedSocket,
  } from '@nestjs/websockets';
  import { Server, Socket } from 'socket.io';
  import { Logger } from '@nestjs/common';
  import { StreamsService } from './stream.service';
  
  @WebSocketGateway({
    cors: {
      origin: ['http://localhost:6006', 'http://localhost:3000'],
      credentials: true,
    },
    namespace: '/stream',
  })
  export class StreamsGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;
  
  private logger = new Logger(StreamsGateway.name);
  private activeStreams = new Map<string, Set<string>>(); // streamId -> Set of viewer socket IDs
  private broadcasterSockets = new Map<string, string>(); // streamId -> broadcaster socket ID

  constructor(private streamsService: StreamsService) {}
  
    handleConnection(client: Socket) {
      this.logger.log(`Client connected: ${client.id}`);
    }
  
    handleDisconnect(client: Socket) {
      this.logger.log(`Client disconnected: ${client.id}`);
      
      // Remove client from all streams
      for (const [streamId, viewers] of this.activeStreams.entries()) {
        if (viewers.has(client.id)) {
          viewers.delete(client.id);
          this.updateViewerCount(streamId, viewers.size);
        }
      }
    }
  
    @SubscribeMessage('join-stream')
    async handleJoinStream(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: { streamId: string },
    ) {
      const { streamId } = data;
      
      if (!this.activeStreams.has(streamId)) {
        this.activeStreams.set(streamId, new Set());
      }
      
      this.activeStreams.get(streamId)!.add(client.id);
      client.join(streamId);
      
      const viewerCount = this.activeStreams.get(streamId)!.size;
      await this.updateViewerCount(streamId, viewerCount);
      
      this.server.to(streamId).emit('viewer-count', { streamId, count: viewerCount });
      
      // Notify broadcaster that a new viewer joined (so they can send offer)
      const broadcasterSocketId = this.broadcasterSockets.get(streamId);
      if (broadcasterSocketId) {
        this.server.to(broadcasterSocketId).emit('viewer-joined', {
          streamId,
          viewerId: client.id,
        });
      }
      
      return { success: true, viewerCount };
    }
  
    @SubscribeMessage('leave-stream')
    async handleLeaveStream(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: { streamId: string },
    ) {
      const { streamId } = data;
      
      if (this.activeStreams.has(streamId)) {
        this.activeStreams.get(streamId)!.delete(client.id);
        const viewerCount = this.activeStreams.get(streamId)!.size;
        await this.updateViewerCount(streamId, viewerCount);
        this.server.to(streamId).emit('viewer-count', { streamId, count: viewerCount });
      }
      
      client.leave(streamId);
      return { success: true };
    }
  
    @SubscribeMessage('start-stream')
    async handleStartStream(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: { streamId: string },
    ) {
      const stream = await this.streamsService.findOne(data.streamId);
      if (stream) {
        await this.streamsService.update(data.streamId, { isLive: true });
        client.join(data.streamId);
        // Store broadcaster socket ID
        this.broadcasterSockets.set(data.streamId, client.id);
        this.server.emit('stream-started', { streamId: data.streamId });
      }
      return { success: true };
    }
  
    @SubscribeMessage('stop-stream')
    async handleStopStream(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: { streamId: string },
    ) {
      const stream = await this.streamsService.findOne(data.streamId);
      if (stream) {
        await this.streamsService.update(data.streamId, { isLive: false });
        this.server.to(data.streamId).emit('stream-stopped', { streamId: data.streamId });
        // Remove broadcaster tracking
        this.broadcasterSockets.delete(data.streamId);
      }
      return { success: true };
    }
  
    // WebRTC signaling
    @SubscribeMessage('offer')
    handleOffer(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: { streamId: string; offer: RTCSessionDescriptionInit; to?: string },
    ) {
      if (data.to) {
        // Send offer to specific viewer by socket ID
        this.server.to(data.to).emit('offer', {
          offer: data.offer,
          from: client.id,
        });
      } else {
        // Broadcast offer to all viewers in the stream room (except sender)
        client.to(data.streamId).emit('offer', {
          offer: data.offer,
          from: client.id,
        });
      }
    }
  
    @SubscribeMessage('answer')
    handleAnswer(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: { streamId: string; answer: RTCSessionDescriptionInit; to: string },
    ) {
      client.to(data.to).emit('answer', {
        answer: data.answer,
        from: client.id,
      });
    }
  
    @SubscribeMessage('ice-candidate')
    handleIceCandidate(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: { streamId: string; candidate: RTCIceCandidateInit; to?: string },
    ) {
      if (data.to) {
        client.to(data.to).emit('ice-candidate', {
          candidate: data.candidate,
          from: client.id,
        });
      } else {
        client.to(data.streamId).emit('ice-candidate', {
          candidate: data.candidate,
          from: client.id,
        });
      }
    }
  
    private async updateViewerCount(streamId: string, count: number) {
      await this.streamsService.update(streamId, { viewerCount: count });
    }
  }