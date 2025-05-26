import User from "../models/user.model.js";
import bcrypt from "bcryptjs"
import { generateToken } from "../lib/utlist.js";
import cloudinary from "../lib/cloudinar.js";

export const signup = async (req, res) => {
    const { name, email, password} = req.body
    try{
        if(!name){
            return res.status(400).json({message: "Name is required"});
        }
        else if(!email){
            return res.status(400).json({message: "Email is required"});
        }
        else if(!password){
            return res.status(400).json({message: "Password is required"});
        }
        if(password.length < 6){
            return res.status(400).json({message: "Password must be least 6 characters"});
        }

        const user = await User.findOne({email});

        if(user) return res.status(400).json({message: "Email already exits"}) ;

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = new User({
            name,
            email,
            password:hashedPassword,
        });

        if(newUser){
            generateToken(newUser._id, res)
            await newUser.save(),
            res.status(201).json({
                _id: newUser._id,
                name: newUser.name,
                email: newUser.email,
                profileImg: newUser.profileImage
            });
        }
        else{
            res.status(400).json({message: "Invalid user data"});
        }
    }
    catch(error){
        console.log("Error signup controller", error.message);
        return res.status(400).json({message: "Internal Server Error"});
    }
};

export const login = async (req, res) => {
    const {email, password} = req.body;

    try {
        const user = await User.findOne({email});

        if(!user){
            return res.status(400).json({message: "Invalid credentials"});
        }

        const checkPassword = await bcrypt.compare(password, user.password);

        if(!checkPassword){
            return res.status(400).json({message: "Invalid password"});
        }

        generateToken(user._id, res);

        res.status(201).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            profileImg: user.profileImage
        });

    } catch (error) {
        console.log("Error login controller", error.message);
        return res.status(400).json({message: "Internal Server Error"});
    }
};

export const logout = (req, res) => {
  try {
    res.cookie("jwt", "", {maxAge:0});
    return res.status(200).json({message: "Logout success   "});
  } catch (error) {
    console.log("Error logout controller", error.message);
    return res.status(400).json({message: "Internal Server Error"});
  }
};

export const updateProfile = async (req, res) => {
    try {
        const {profileImage} = req.body;
        const userId = req.user._id;
        if(!profileImage){
         return res.status(400).json({message: "Profile Image is required"});
        }

        const uploadResponse = await cloudinary.uploader.upload(profileImage);

        const userUpdate = await User.findByIdAndUpdate(userId, {profileImage:uploadResponse.secure_url}, {new:true});

        res.status(200).json(userUpdate);
    } catch (error) {
      console.log("Error update profile ", error.message);
      return res.status(400).json({message: "Internal Server Error"});
    }
  };

export const checkAuth = (req, res) => {
    try {
        res.status(200).json(req.user);
    } catch (error) {
      console.log("Error check auth ", error.message);
      return res.status(500).json({message: "Internal Server Error"});
    }
  };