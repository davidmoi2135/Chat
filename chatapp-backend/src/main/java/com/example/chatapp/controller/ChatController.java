package com.example.chatapp.controller;

import com.example.chatapp.model.ChatMessage;
import com.example.chatapp.service.PresenceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.util.Map;
import java.util.Set;

@Controller
public class ChatController {
    private static final Logger log = LoggerFactory.getLogger(ChatController.class);

    private final SimpMessagingTemplate simp;
    private final PresenceService presenceService;

    @Autowired
    public ChatController(SimpMessagingTemplate simp, PresenceService presenceService) {
        this.simp = simp;
        this.presenceService = presenceService;
    }

    @org.springframework.messaging.handler.annotation.MessageMapping("/sendMessage")
    public void sendMessage(ChatMessage message, SimpMessageHeaderAccessor headerAccessor) {
        if (message == null) return;
        String roomId = message.getRoomId() == null ? "default" : String.valueOf(message.getRoomId());
        String type = message.getType() == null ? "CHAT" : message.getType().toUpperCase();
        String sessionId = headerAccessor.getSessionId();
        String sender = message.getSender();

        if ("JOIN".equals(type)) {
            presenceService.addMember(sessionId, roomId, sender);
            Set<String> members = presenceService.getMembers(roomId);
            log.info("JOIN: sessionId={}, roomId={}, sender={}, membersCount={}", sessionId, roomId, sender, members.size());

            // broadcast JOIN so existing participants see it
            simp.convertAndSend("/topic/message", message);

            // send private list to the joining session (target by session)
            SimpMessageHeaderAccessor accessor = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
            accessor.setSessionId(sessionId);
            accessor.setLeaveMutable(true);
            Map<String,Object> headers = accessor.getMessageHeaders();

            simp.convertAndSendToUser(sessionId, "/queue/members", members, headers);

            // optional debug broadcast
            simp.convertAndSend("/topic/" + roomId + "/members", members);
            return;
        }

        if ("LEAVE".equals(type)) {
            presenceService.removeBySession(sessionId);
            log.info("LEAVE: sessionId={}, sender={}, roomId={}", sessionId, sender, roomId);
            simp.convertAndSend("/topic/message", message);
            simp.convertAndSend("/topic/" + roomId + "/members", presenceService.getMembers(roomId));
            return;
        }

        // normal chat
        simp.convertAndSend("/topic/message", message);
    }
}