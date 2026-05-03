'use client'
import { signIn } from "next-auth/react"; // Add this line
import { useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useState } from 'react'
import { toast } from "react-hot-toast";





const Login = () => {
    const [isLoading, setLoading] = useState<boolean>(false);
    const [googlLoad,setGoogleLoad] = useState(false)
    const [step, setStep] = useState(1) //1 -login form  2 - otp form
    const [email, setEmail] = useState("")
    const [username, setUsername] = useState("")
    const [otp, setOtp] = useState("")
    const router = useRouter();



    const handleOtpSend = async () => {
        if (!email || !username) return toast.error("Please fill all fields");
        setLoading(true);
        try {
            const res = await fetch("/api/auth/send-otp/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email })
            });
    
            const data = await res.json();
    
            if (res.ok) {
                toast.success("OTP sent to your email!");
                setStep(2);
            } else {
                toast.error(data.error || "Something went wrong");
            }
    
        } catch (error) {
            toast.error("Failed to send OTP.");
        } finally {
            setLoading(false);
        }
    }



const handleVerifyOtp = async () => {
    if (!otp) return toast.error("Please enter the OTP");
    setLoading(true);
    try {
        const res = await signIn("credentials", {
            email,
            username,
            otp,
            redirect: false, // handle redirect manually
        });

        if (res?.ok) {
            toast.success("Welcome to OmniMind!");
            router.push("/dashboard");
        } else {
            toast.error("Invalid or expired OTP.");
        }
    } catch (error) {
        toast.error("Something went wrong.");
    } finally {
        setLoading(false);
    }
}






    const handleGoogleLogin = async () => {

        try {
            setGoogleLoad(true);
            await signIn('google');

        } catch (error) {
            console.error('Google login failed:', error);
            toast.error('Google login failed. Please try again.');

        } finally {
            setGoogleLoad(false);
        }


    }
    const searchParams = useSearchParams();

    useEffect(() => {
        const error = searchParams.get("error");
        
        if (error === "ALREADY_EXISTS_WITH_EMAIL") {
            toast.error("This email is already registered via OTP. Please log in using the email form.");
            // Clean the URL so the toast doesn't repeat on refresh
            router.replace("/"); 
        }
        
        if (error === "OAuthSignin" || error === "OAuthCallback") {
            toast.error("An error occurred during Google login. Please try again.");
        }
    }, [searchParams, router]);



    return (
        <div className="w-full max-w-md p-8 relative">
            {/* Background Glow Effect */}
            <div className="absolute inset-0 bg-[rgba(210,140,160,0.1)] blur-3xl rounded-full" />

            {/* Main Card */}
            <div className="relative backdrop-blur-xl bg-white/[0.03] border border-white/10 p-10 rounded-2xl shadow-2xl">
                <div className="mb-8">
                    <h2 className="text-2xl font-light text-white tracking-tight">
                        Welcome <span className="text-[rgba(210,140,160,0.9)] font-semibold">Back</span>
                    </h2>
                    <p className="text-sm text-white/40 mt-2 tracking-wide">
                        Enter your details to access OmniMind.
                    </p>
                </div>

                {step === 1 ? (
                    <>






                    <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
                        {/* Username Field */}
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase tracking-[0.2em] text-white/50 ml-1">
                                Username
                            </label>
                            <input
                                type="text"
                                placeholder="user_name"
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-[rgba(210,140,160,0.5)] transition-all text-sm"
                            />
                        </div>

                        {/* Email Field */}
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase tracking-[0.2em] text-white/50 ml-1">
                                Email Address
                            </label>
                            <input
                                type="email"
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="name@example.com"
                                className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-[rgba(210,140,160,0.5)] transition-all text-sm"
                            />
                        </div>

                        {/* Submit Button */}
                        <button 
  onClick={() => {
    console.log(email, username);
    handleOtpSend(); // Call your OTP function here
  }} 
  className="w-full group relative flex items-center justify-center gap-2 bg-white text-black font-medium py-3 rounded-lg 
             hover:bg-[rgba(210,140,160,0.9)] hover:text-white 
             cursor-pointer select-none
             active:scale-95 transition-all duration-150 ease-out overflow-hidden"
>
    <span className="relative z-10 text-xs uppercase tracking-widest pointer-events-none">
       { isLoading ? "Sending OTP..." : "Continue"}
    </span>
</button>
                    </form>

                {/* Divider */}
                <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full border-t border-white/5"></div>
                    </div>
                    <div className="relative flex justify-center text-[10px] uppercase tracking-widest">
                        <span className="bg-[#0b0410] px-2 text-white/30">Or secure access via</span>
                    </div>
                </div>

                {/* Google Login Button */}
                <button
                    onClick={handleGoogleLogin}
                    className="w-full flex items-center justify-center gap-3 bg-white/[0.03] border border-white/10 py-3 rounded-lg hover:bg-white/[0.08] active:scale-95 transition-transform duration-150 ease-in-out cursor-pointer"                >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path
                            fill="currentColor"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                            fill="#4285F4"
                        />
                        <path
                            fill="currentColor"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                            fill="#34A853"
                        />
                        <path
                            fill="currentColor"
                            d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
                            fill="#FBBC05"
                        />
                        <path
                            fill="currentColor"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                            fill="#EA4335"
                        />
                    </svg>
                    <span className="text-white/80 text-xs uppercase tracking-widest font-light">
                        {googlLoad ? "Connecting to Google..." : "Continue with Google"}                    </span>
                </button>
</>


                ):(
                /* OTP VERIFICATION STEP */
                <div className="animate-in fade-in zoom-in duration-300">
                    <div className="mb-8 text-center">
                        <h2 className="text-2xl font-light text-white tracking-tight">Verify <span className="text-[rgba(210,140,160,0.9)] font-semibold">Email</span></h2>
                        <p className="text-xs text-white/40 mt-2">Code sent to {email}</p>
                    </div>

                    <div className="space-y-6 h-full">
                        <input
                            type="text"
                            maxLength={6}
                            value={otp}
                            onChange={(e) => setOtp(e.target.value)}
                            placeholder="Enter Otp"
                            className="w-full h-10 bg-white/[0.05] border border-white/10 rounded-lg px-4 py-4 text-center text-sm text-white focus:outline-none focus:border-[rgba(210,140,160,0.5)] transition-all"                        />

                        <button
                            onClick={handleVerifyOtp}
                            disabled={isLoading}
                            className="w-full bg-[rgba(210,140,160,0.9)] text-white font-medium py-3 rounded-lg hover:bg-[rgba(210,140,160,1)] transition-all shadow-lg shadow-[rgba(210,140,160,0.2)]"
                        >
                            {isLoading ? "Verifying..." : "Verify & Access"}
                        </button>

                        <button
                            onClick={() => setStep(1)}
                            className="w-full text-[10px] uppercase tracking-widest text-white/30 hover:text-white/60 transition-colors"
                        >
                            Back to Edit Email
                        </button>
                    </div>
                </div>
                )
                 }



                {/* Footer Link */}
                {/* <p className="text-center mt-8 text-[11px] text-white/30 tracking-widest uppercase">
          New to OmniMind? <span className="text-[rgba(210,140,160,0.8)] cursor-pointer hover:underline">Request Access</span>
        </p> */}
            </div>
        </div>
    )
}

export default Login