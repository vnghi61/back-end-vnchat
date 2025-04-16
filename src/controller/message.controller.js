import cloudinary from "../lib/cloudinar.js";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";

export const getUser = async (req, res) => {
    try{
        const loggedInUserId = req.user._id;
        const filteredUsers = await User.find({_id:{$ne:loggedInUserId}}).select("-password");
        return res.status(200).json(filteredUsers);
    }
    catch(error){
        console.log("Error getUser", error.message);
        return res.status(500).json({message: "Internal Server Error"});
    }
};

export const getMessages = async (req, res) => {
    try {
        const {id:UserToChatId} = req.params;
        const senderId = req.user._id;
    
        const message = await Message.find({
            $or:[
                {senderId:senderId, receiverId: UserToChatId},
                {senderId:UserToChatId, receiverId: senderId}
            ]
        });
    
        return res.status(200).json(message);

    } catch (error) {
        console.log("Error in getMessages controller", error.message);
        return res.status(500).json({message: "Internal Server Error"});
    }
};

export const sendMessages = async (req, res) => {
    try {
        const {id:UserToChatId} = req.params;
        const senderId = req.user._id;
        const {text, image} = req.body;

        let imageUrl;
        if(image){
            const uploadReponse = await cloudinary.uploader.upload(image);
            imageUrl = uploadReponse.secure_url;
        }
    
        const newMessage = new Message({
            senderId,
            UserToChatId,
            text,
            image
        });

        await newMessage.save(),
        res.status(201).json({
            senderId,
            UserToChatId,
            text,
            image: imageUrl, 
        });
    
        return res.status(200).json(newMessage);

    } catch (error) {
        console.log("Error in getMessages controller", error.message);
        return res.status(500).json({message: "Internal Server Error"});
    }
};