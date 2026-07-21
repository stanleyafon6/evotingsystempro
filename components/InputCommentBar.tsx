import React, { memo, useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Entypo, MaterialIcons } from '@expo/vector-icons';

type Props = {
  currentMessage: string;
  setCurrentMessage: (text: string) => void;
  inputHeight: number;
  setInputHeight: (height: number) => void;
  onSendImage: () => void;
  onSend: () => void;
};

const InputCommentBar = ({
  currentMessage,
  setCurrentMessage,
  inputHeight,
  setInputHeight,
  onSendImage,
  onSend
}: Props) => {
  
  const handleSend = () => {
    if (currentMessage.trim().length > 0) {
      onSend();
      setCurrentMessage(""); // clear input after sending
      setInputHeight(40); // reset height
    }
  };

  return (
    <View style={[styles.inputWrapper, { marginBottom: Platform.OS === 'ios' ? 40 : 5 }]}>
      <TouchableOpacity style={{ position: "relative", top: -9 }}>
        <Entypo name="emoji-happy" size={24} color="#555" />
      </TouchableOpacity>

      <TextInput
        value={currentMessage}
        onChangeText={setCurrentMessage}
        placeholder="Message"
        multiline
        blurOnSubmit={false} // keeps focus after sending
        onContentSizeChange={(e) =>
          setInputHeight(Math.min(e.nativeEvent.contentSize.height, 120))
        }
        style={[styles.input, { height: Math.max(40, inputHeight) }]}
        placeholderTextColor="#999"
        onSubmitEditing={() => {
          // Mobile "Enter/Send" key
          if (Platform.OS !== "web") {
            handleSend();
          }
        }}
        onKeyPress={(e) => {
          const { key, shiftKey } = e.nativeEvent as any;
          if (key === "Enter" && !shiftKey) {
            e.preventDefault?.(); // prevent newline
            handleSend();
          }
        }}
      />

      <TouchableOpacity style={{ position: "relative", top: -9 }} onPress={onSendImage}>
        <MaterialIcons name="attach-file" size={24} color="#555" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
        <MaterialIcons name="send" size={24} color="#fff" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    marginTop: 10,
    margin: 10,
    paddingVertical: 2,
    backgroundColor: '#ffffffce',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 50,
  },
  input: {
    flex: 1,
    borderRadius: 50,
    paddingHorizontal: 5,
     backgroundColor: "#fff",
    ...(Platform.OS === "web" && {
      outlineStyle: "none" as any,
      outlineWidth: 0 as any,
    }),
    paddingTop: 8,
    paddingBottom: 8,
    marginHorizontal: 8,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  sendButton: {
    backgroundColor: '#25D366',
    padding: 10,
    position: "relative",
    left: 5,
    borderRadius: 50,
  },
});

export default memo(InputCommentBar);
