using System;
using System.Linq;
using System.Threading;
using LibreHardwareMonitor.Hardware;
using NvAPIWrapper;
using NvAPIWrapper.GPU;

namespace FanTest
{
    class Program
    {
        static void Main(string[] args)
        {
            Console.WriteLine("Starting FanTest...");
            
            // Test NvAPI Direct Control
            try 
            {
                Console.WriteLine("Initializing NvAPI...");
                NVIDIA.Initialize();
                Console.WriteLine("NvAPI Initialized.");

                var gpus = PhysicalGPU.GetPhysicalGPUs();
                foreach (var gpu in gpus)
                {
                    Console.WriteLine($"Found GPU: {gpu.FullName}");
                    var cooler = gpu.CoolerInformation;
                    
                    try {
                        if (cooler.Coolers != null) 
                        {
                        Console.WriteLine("  Controlling fans via NvAPI...");
                        if (cooler.Coolers != null) 
                        {
                            foreach (var c in cooler.Coolers)
                            {
                                Console.WriteLine($"    Cooler ID: {c.CoolerId}, Current: {c.CurrentLevel}%");
                                
                                Console.WriteLine($"    Setting Cooler {c.CoolerId} to 70%...");
                                cooler.SetCoolerSettings(c.CoolerId, 70);
                                
                                Thread.Sleep(2000);
                                // Refresh cooler info? NvAPI objects might be stale. 
                                // But let's just read the property again if it updates.
                                Console.WriteLine($"    Readback: {c.CurrentLevel}%");
                                
                                Console.WriteLine($"    Setting Cooler {c.CoolerId} to 50%...");
                                cooler.SetCoolerSettings(c.CoolerId, 50);
                                
                                Thread.Sleep(2000);
                                Console.WriteLine($"    Readback: {c.CurrentLevel}%");
                            }
                        }
                        }
                    } catch (Exception ex) {
                        Console.WriteLine($"  Cooler Error: {ex.Message}");
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"NvAPI Error: {ex.Message}");
            }

            Console.WriteLine("\n--- LHM Test ---");

            var computer = new Computer
            {
                IsGpuEnabled = true,
                IsCpuEnabled = true,
                IsMotherboardEnabled = true,
                IsControllerEnabled = true
            };

            try
            {
                Console.WriteLine("Opening computer...");
                computer.Open();
                Console.WriteLine("Computer opened.");

                foreach (var hardware in computer.Hardware)
                {
                    Console.WriteLine($"Hardware: {hardware.Name} ({hardware.HardwareType})");
                    hardware.Update();

                    foreach (var sensor in hardware.Sensors)
                    {
                        Console.WriteLine($"  Sensor: {sensor.Name}, Type: {sensor.SensorType}, Value: {sensor.Value}");
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"ERROR: {ex.Message}");
                Console.WriteLine(ex.StackTrace);
            }
            finally
            {
                computer.Close();
            }

            Console.WriteLine("Done. Press Enter to exit.");
            Console.ReadLine();
        }
    }
}
